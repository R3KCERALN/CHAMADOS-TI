// Single timezone configuration for display, operational filters and management reports.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Belem';
new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TIMEZONE }).format();
