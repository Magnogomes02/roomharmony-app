/**
 * Valores em dinheiro são comparados e somados em centavos inteiros: em ponto
 * flutuante, 10,10 + 20,20 dá 30,299999…, o que deixava uma parcela quitada
 * como "parcial" com saldo de R$ 0,00.
 */
export function toCents(value: number | string | null | undefined): number {
  return Math.round((Number(value) || 0) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
