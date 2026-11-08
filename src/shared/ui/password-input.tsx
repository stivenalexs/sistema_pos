"use client";

import Image from "next/image";
import { type InputHTMLAttributes, useState } from "react";

// Password field with the "show" eye of the Figma login (D-046). The eye is a
// display helper, not an action: it only switches the input type.
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={visible ? "text" : "password"} className="field pr-12" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center"
      >
        <Image src="/brand/eye.svg" alt="" width={19} height={19} />
      </button>
    </span>
  );
}
