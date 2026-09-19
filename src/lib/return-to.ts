export function ticketReturnTo(value: unknown) {
  return typeof value === 'string' && /^\/chamados\/[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : '/';
}
