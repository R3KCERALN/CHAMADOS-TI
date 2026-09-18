import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="standalone">
      <section className="panel padded">
        <span className="eyebrow">PÁGINA INDISPONÍVEL</span>
        <h1>Não encontramos este registro.</h1>
        <p className="muted">Ele pode não existir ou não estar disponível para seu perfil.</p>
        <Link href="/" className="button primary">
          Voltar ao início
        </Link>
      </section>
    </main>
  );
}
