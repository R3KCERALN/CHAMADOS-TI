// Single timezone configuration for display, operational filters and management reports.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Belem';
new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TIMEZONE }).format();
// Installation scope, never accepted from a login form or request parameter.
export const APP_ORGANIZATION_ID = process.env.APP_ORGANIZATION_ID || 'initial-organization';
