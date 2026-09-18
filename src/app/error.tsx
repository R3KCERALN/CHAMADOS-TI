'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="standalone">
      <section className="panel padded">
        <h1>Não foi possível carregar esta página.</h1>
        <p className="muted">
          Tente novamente em instantes. Se o problema continuar, fale com o administrador.
        </p>
        <button className="button primary" onClick={reset}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
