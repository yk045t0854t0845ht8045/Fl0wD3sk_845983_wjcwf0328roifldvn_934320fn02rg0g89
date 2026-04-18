const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export type PasswordPolicyFeedback = {
  minLengthMet: boolean;
  maxLengthMet: boolean;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  hasControlCharacters: boolean;
  score: number;
};

export function evaluatePasswordPolicy(password: string): PasswordPolicyFeedback {
  const value = typeof password === "string" ? password : "";
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(value);
  const hasControlCharacters = /[\u0000-\u001F\u007F]/.test(value);
  const score = [
    value.length >= MIN_PASSWORD_LENGTH,
    hasLowercase,
    hasUppercase,
    hasNumber,
    hasSymbol,
  ].filter(Boolean).length;

  return {
    minLengthMet: value.length >= MIN_PASSWORD_LENGTH,
    maxLengthMet: value.length <= MAX_PASSWORD_LENGTH,
    hasLowercase,
    hasUppercase,
    hasNumber,
    hasSymbol,
    hasControlCharacters,
    score,
  };
}

export function validatePasswordPolicy(
  password: string,
  confirmPassword?: string | null,
) {
  const value = typeof password === "string" ? password : "";
  const feedback = evaluatePasswordPolicy(value);

  if (!feedback.minLengthMet) {
    return `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres na senha.`;
  }

  if (!feedback.maxLengthMet) {
    return `A senha ultrapassa o limite de ${MAX_PASSWORD_LENGTH} caracteres.`;
  }

  if (feedback.hasControlCharacters) {
    return "A senha contem caracteres invalidos. Remova caracteres de controle e tente novamente.";
  }

  const complexitySignals = [
    feedback.hasLowercase,
    feedback.hasUppercase,
    feedback.hasNumber,
    feedback.hasSymbol,
  ].filter(Boolean).length;

  if (complexitySignals < 3) {
    return "Use pelo menos tres destes grupos: letra minuscula, letra maiuscula, numero e simbolo.";
  }

  if (typeof confirmPassword === "string" && value !== confirmPassword) {
    return "A confirmacao da senha nao confere.";
  }

  return null;
}

export function getPasswordPolicyChecklist(password: string) {
  const feedback = evaluatePasswordPolicy(password);

  return [
    {
      id: "password-length",
      label: `Minimo de ${MIN_PASSWORD_LENGTH} caracteres`,
      valid: feedback.minLengthMet,
    },
    {
      id: "password-lower-upper",
      label: "Misture letras minusculas e maiusculas",
      valid: feedback.hasLowercase && feedback.hasUppercase,
    },
    {
      id: "password-number",
      label: "Inclua pelo menos um numero",
      valid: feedback.hasNumber,
    },
    {
      id: "password-symbol",
      label: "Inclua pelo menos um simbolo",
      valid: feedback.hasSymbol,
    },
  ];
}
