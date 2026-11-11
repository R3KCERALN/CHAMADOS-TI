export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { validateRuntime } = await import('./lib/production-config');
      try {
        validateRuntime();
      } catch (error) {
        console.error('runtime_configuration_invalid');
        if (process.env.APP_ENV === 'production') process.exit(1);
        throw error;
      }
    }
    const { startPushWorker } = await import('./lib/push-worker');
    startPushWorker();
    const { startStockMaintenance } = await import('./lib/stock-review');
    startStockMaintenance();
  }
}
