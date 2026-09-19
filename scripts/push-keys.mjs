import { readFileSync, appendFileSync, chmodSync } from 'node:fs';
import { parse } from 'dotenv';
import webPush from 'web-push';
const [file = '.env', subject] = process.argv.slice(2);
if (
  !['.env', '.env.demo'].includes(file) ||
  !subject ||
  !/^(mailto:|https:\/\/)/.test(subject) ||
  /[\r\n]/.test(subject)
)
  throw new Error('Uso: npm run push:keys -- .env mailto:ti@empresa.com (ou .env.demo).');
const env = parse(readFileSync(file));
if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY || env.VAPID_SUBJECT)
  throw new Error(
    'VAPID já configurado parcialmente ou por completo. Nenhuma chave foi sobrescrita.',
  );
const keys = webPush.generateVAPIDKeys();
webPush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
appendFileSync(
  file,
  `\n# Web Push — mantenha estas chaves estáveis\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${subject}\n`,
);
chmodSync(file, 0o600);
console.log(`Chaves VAPID gravadas em ${file}, sem exibir segredos. Reinicie a aplicação.`);
