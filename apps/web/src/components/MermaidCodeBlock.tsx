import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";

type MermaidModule = typeof import("mermaid")["default"];

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let mermaidRenderSequence = 0;

const loadMermaid = () => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then(({ default: mermaid }) => {
      return mermaid;
    });
  }

  return mermaidModulePromise;
};

export const MermaidCodeBlock = ({ editor, node }: NodeViewProps) => {
  const { t } = useTranslation();
  const language = typeof node.attrs.language === "string" ? node.attrs.language.toLowerCase() : "plaintext";
  const source = node.textContent.trim();
  const isMermaid = language === "mermaid";
  const [svg, setSvg] = useState("");
  const [sourceVisible, setSourceVisible] = useState(false);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!isMermaid || !source) {
      setSvg("");
      setRenderState("idle");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRenderState("loading");

      void loadMermaid()
        .then(async (mermaid) => {
          const dark = document.documentElement.classList.contains("dark");
          const ink = dark ? "#cbd5e1" : "#26384a";
          const surface = dark ? "#0f172a" : "#ffffff";
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: "base",
            themeVariables: {
              background: "transparent",
              primaryColor: surface,
              primaryTextColor: ink,
              primaryBorderColor: ink,
              lineColor: ink,
              textColor: ink,
              mainBkg: surface,
              nodeBorder: ink,
              edgeLabelBackground: surface,
              actorBkg: surface,
              actorBorder: ink,
              actorTextColor: ink,
              signalColor: ink,
              signalTextColor: ink,
            },
          });
          const valid = await mermaid.parse(source, { suppressErrors: true });
          if (!valid) {
            throw new Error("Invalid Mermaid diagram");
          }

          mermaidRenderSequence += 1;
          return mermaid.render(`edgeever-mermaid-${mermaidRenderSequence}`, source);
        })
        .then(({ svg: nextSvg }) => {
          if (!cancelled) {
            setSvg(nextSvg);
            setRenderState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSvg("");
            setRenderState("error");
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isMermaid, source]);

  return (
    <NodeViewWrapper
      className={isMermaid
        ? `edgeever-mermaid-code-block${sourceVisible ? " is-source-visible" : ""}`
        : "edgeever-code-block"}
      data-language={language}
    >
      {isMermaid && (
        <div
          className="edgeever-mermaid-preview"
          contentEditable={false}
          onClick={() => editor.isEditable && setSourceVisible((visible) => !visible)}
          onKeyDown={(event) => {
            if (editor.isEditable && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setSourceVisible((visible) => !visible);
            }
          }}
          aria-label={editor.isEditable
            ? `${t("editorToolbar.mermaidPreview")} · ${t("editorToolbar.mermaidSource")}`
            : undefined}
          role={editor.isEditable ? "button" : undefined}
          tabIndex={editor.isEditable ? 0 : undefined}
        >
          {!source && <p className="edgeever-mermaid-message">{t("editorToolbar.mermaidEmpty")}</p>}
          {source && renderState === "loading" && !svg && (
            <p className="edgeever-mermaid-message">{t("editorToolbar.mermaidRendering")}</p>
          )}
          {renderState === "error" && (
            <p className="edgeever-mermaid-error" role="alert">
              {t("editorToolbar.mermaidInvalid")}
            </p>
          )}
          {svg && (
            <div
              className="edgeever-mermaid-svg"
              role="img"
              aria-label={t("editorToolbar.mermaidPreview")}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      )}
      <NodeViewContent
        className={isMermaid ? "edgeever-code-source edgeever-mermaid-source" : "edgeever-code-source"}
        role="textbox"
        aria-label={isMermaid ? t("editorToolbar.mermaidSource") : undefined}
        aria-multiline="true"
        aria-readonly={!editor.isEditable}
      />
    </NodeViewWrapper>
  );
};
