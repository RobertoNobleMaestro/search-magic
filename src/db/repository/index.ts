import type { Repository } from '../../lib/data/types';
import { getDb, type Db } from '../client';
import { DbCatalogLookup } from './catalog';
import * as web from './web';
import * as worker from './worker';

/**
 * Implementación de `Repository` contra PostgreSQL (Neon en producción).
 * Sin argumento usa la conexión pooled de la web (DATABASE_URL), creada al primer uso.
 */
export function createDbRepository(db?: Db): Repository {
  const conn = () => db ?? getDb();
  const catalog = new DbCatalogLookup(conn);
  return {
    loadCatalog: () => catalog.loadCatalog(),
    findByExactName: (nameNorm, lang) => catalog.findByExactName(nameNorm, lang),
    findByTrigram: (nameNorm, minSimilarity, limit) => catalog.findByTrigram(nameNorm, minSimilarity, limit),
    resolveSet: (hint) => catalog.resolveSet(hint),
    findPrintings: (oracleId, setCode) => catalog.findPrintings(oracleId, setCode),
    getOverride: (storeId, titleNorm) => catalog.getOverride(storeId, titleNorm),

    autocomplete: (q, limit) => web.autocomplete(conn(), q, limit),
    searchCards: (q, limit) => web.searchCards(conn(), q, limit),
    getCard: (oracleId) => web.getCard(conn(), oracleId),
    getOffers: (oracleId, filters) => web.getOffers(conn(), oracleId, filters),
    listStores: () => web.listStores(conn()),
    getStore: (id) => web.getStore(conn(), id),
    listUnmatched: (opts) => web.listUnmatched(conn(), opts),
    listLatestRuns: () => web.listLatestRuns(conn()),

    upsertStores: (configs) => worker.upsertStores(conn(), configs),
    startRun: (storeId) => worker.startRun(conn(), storeId),
    saveListings: (runId, items) => worker.saveListings(conn(), runId, items),
    finishRun: (runId, result) => worker.finishRun(conn(), runId, result),
  };
}
