import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import SignaturePad from "signature_pad";

export interface ZoneSignatureHandle {
  clear: () => void;
}

// Capture tactile de la signature (décision actée) : touch-action: none
// sur le canvas — indispensable, sinon le navigateur mobile interprète le
// tracé comme un geste de défilement de page plutôt qu'un dessin.
// `actif` gèle la zone (SignaturePad.off()) jusqu'à ce que « Lu et
// approuvé » soit cochée — un tracé commencé avant ne doit jamais être
// possible. Le ratio de résolution interne est plafonné à 2 (pas le
// devicePixelRatio brut, qui peut valoir 3 sur un téléphone récent) : au-
// delà, le PNG généré grossit sans bénéfice visuel perceptible pour un
// simple tracé, et approche inutilement la limite de 512 Ko
// (TAILLE_MAX_IMAGE_SIGNATURE_OCTETS, décoder-image-signature.ts).
export const ZoneSignature = forwardRef<
  ZoneSignatureHandle,
  {
    actif: boolean;
    onChange: (dataUrlPng: string | null) => void;
  }
>(function ZoneSignature({ actif, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255, 255, 255)" });
    padRef.current = pad;

    function redimensionner(): void {
      // Renarrowing explicite : TS ne propage pas le `if (!canvas) return`
      // ci-dessus jusqu'à l'intérieur d'une déclaration de fonction
      // imbriquée (appelée plus tard, potentiellement de façon
      // asynchrone) — `canvas` y reste typé nullable sans ce garde.
      if (!canvas) {
        return;
      }
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      if (width === 0 || height === 0) {
        return;
      }
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext("2d");
      ctx?.scale(ratio, ratio);
      pad.clear();
    }
    redimensionner();
    window.addEventListener("resize", redimensionner);

    function signaler(): void {
      onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"));
    }
    pad.addEventListener("endStroke", signaler);
    pad.off();

    return () => {
      window.removeEventListener("resize", redimensionner);
      pad.removeEventListener("endStroke", signaler);
      pad.off();
    };
  }, []);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }
    if (actif) {
      pad.on();
    } else {
      pad.off();
    }
  }, [actif]);

  useImperativeHandle(ref, () => ({
    clear: () => {
      padRef.current?.clear();
      onChangeRef.current(null);
    }
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{ touchAction: "none" }}
      role="img"
      aria-label="Zone de signature"
      className={`h-36 w-full rounded-md border ${
        actif ? "border-indigo-400 bg-white" : "border-slate-200 bg-slate-50 opacity-60"
      }`}
    />
  );
});
