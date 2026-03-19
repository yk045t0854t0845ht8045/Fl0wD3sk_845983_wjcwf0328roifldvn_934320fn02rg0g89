export function normalizeBrazilDocumentDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function resolveBrazilDocumentType(digits: string) {
  if (digits.length === 11) return "CPF" as const;
  if (digits.length === 14) return "CNPJ" as const;
  return null;
}

function allDigitsEqual(value: string) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(cpf: string) {
  if (cpf.length !== 11) return false;
  if (allDigitsEqual(cpf)) return false;

  const digits = cpf.split("").map((digit) => Number(digit));

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += digits[index] * (10 - index);
  }

  let firstCheckDigit = (sum * 10) % 11;
  if (firstCheckDigit === 10) {
    firstCheckDigit = 0;
  }

  if (firstCheckDigit !== digits[9]) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += digits[index] * (11 - index);
  }

  let secondCheckDigit = (sum * 10) % 11;
  if (secondCheckDigit === 10) {
    secondCheckDigit = 0;
  }

  return secondCheckDigit === digits[10];
}

export function isValidCnpj(cnpj: string) {
  if (cnpj.length !== 14) return false;
  if (allDigitsEqual(cnpj)) return false;

  const digits = cnpj.split("").map((digit) => Number(digit));
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, ...firstWeights];

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += digits[index] * firstWeights[index];
  }

  const firstRemainder = sum % 11;
  const firstCheckDigit = firstRemainder < 2 ? 0 : 11 - firstRemainder;

  if (firstCheckDigit !== digits[12]) return false;

  sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += digits[index] * secondWeights[index];
  }

  const secondRemainder = sum % 11;
  const secondCheckDigit = secondRemainder < 2 ? 0 : 11 - secondRemainder;

  return secondCheckDigit === digits[13];
}

export function isValidBrazilDocument(digits: string) {
  const type = resolveBrazilDocumentType(digits);
  if (type === "CPF") return isValidCpf(digits);
  if (type === "CNPJ") return isValidCnpj(digits);
  return false;
}
