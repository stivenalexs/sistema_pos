// ============================================================================
// TEXTOS LEGALES — PROVISIONALES, PENDIENTES DE APROBACIÓN
// ============================================================================
//
// ESTADO: BORRADOR. Ningún texto de este archivo está aprobado.
// - Debe aprobarlos la persona responsable del proyecto y revisarlos un abogado
//   (P-006: retracto, horarios, publicidad de licor, habeas data).
// - Este archivo está protegido (agents.md §6): Claude no lo modifica sin
//   aprobación expresa. Para cambiar un texto, se propone y una persona lo aprueba.
// - Al aprobar o cambiar cualquier texto, sube LEGAL_COPY_VERSION. La versión se
//   guarda en legal_acceptances con cada aceptación (D-035).
//
// Referencias usadas para el borrador (a validar con el abogado):
// - Ley 124 de 1994: prohíbe el expendio de bebidas embriagantes a menores de edad.
// - Decreto 120 de 2010: exige exhibir de forma visible esa prohibición.
// - Ley 30 de 1986: leyenda "El exceso de alcohol es perjudicial para la salud".
// - Ley 1581 de 2012: autorización previa para el tratamiento de datos personales.

/** Version of the legal texts. Stored with every acceptance. */
export const LEGAL_COPY_VERSION = "0-borrador";

/** True while the texts are drafts. Shown as a warning in non-production builds. */
export const LEGAL_COPY_IS_PROVISIONAL = true;

export const LEGAL_COPY = {
  ageGate: {
    // PROVISIONAL
    title: "¿Eres mayor de edad?",
    // PROVISIONAL
    body: "Este sitio vende bebidas alcohólicas. Para entrar debes tener 18 años o más.",
    // PROVISIONAL
    confirm: "Sí, tengo 18 años o más",
    // PROVISIONAL
    deny: "No, soy menor de edad",
    // PROVISIONAL
    denied:
      "Lo sentimos. En Colombia está prohibida la venta de bebidas alcohólicas a menores de edad.",
  },

  // Aviso permanente: pie de todas las páginas y checkout.
  permanentNotice: {
    // PROVISIONAL — redacción basada en la Ley 124 de 1994; validar con abogado.
    minors: "Prohíbase el expendio de bebidas embriagantes a menores de edad. Ley 124 de 1994.",
    // PROVISIONAL — leyenda de la Ley 30 de 1986; validar con abogado.
    health: "El exceso de alcohol es perjudicial para la salud.",
  },

  signup: {
    // PROVISIONAL
    ageDeclaration:
      "Declaro que tengo 18 años o más y que la fecha de nacimiento que ingresé es verdadera.",
    // PROVISIONAL — falta el documento de términos y condiciones.
    terms: "Acepto los términos y condiciones de venta.",
    // PROVISIONAL — falta la política de tratamiento de datos (Ley 1581 de 2012).
    privacy:
      "Autorizo el tratamiento de mis datos personales de acuerdo con la política de tratamiento de datos.",
  },
} as const;
