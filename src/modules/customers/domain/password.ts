// Password rule (D-035), without imports so that Client Components can use it.

export const PASSWORD_MIN_LENGTH = 8;

/** 8+ characters with letters and digits, or the message to show. */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;
  }
  return null;
}
