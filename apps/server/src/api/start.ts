// `npm start`: produção por padrão (cookies secure, sem segredos fixos nem caixa postal de dev).
// Quem quiser outro modo define NODE_ENV explicitamente (o e2e usa NODE_ENV=test).
process.env.NODE_ENV ||= 'production';
await import('./main.ts');
export {};
