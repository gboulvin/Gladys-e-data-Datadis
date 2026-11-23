// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen (manifest
// `actions` field), registered by index.js with `gladys.onAction(key, ...)`.
// The resolved multi-language message is shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DatadisError } from './datadis.js';
import { hasCredentials } from './config.js';
import { errorMessage } from './sync.js';

const logger = createLogger({ name: 'actions' });

export const ACTIONS = {
  // Log in and list the supplies, without reading any consumption: the quick
  // "are my credentials right?" check.
  async test_connection(_gladys, { config, createClient }) {
    logger.info('Action test_connection');
    if (!hasCredentials(config)) {
      return errorMessage('credentials');
    }
    try {
      const supplies = await createClient(config).getSupplies();
      const n = supplies.length;
      return {
        en: `Connected to Datadis: ${n} supply point(s) found.`,
        fr: `Connecté à Datadis : ${n} point(s) de livraison trouvé(s).`,
        de: `Mit Datadis verbunden: ${n} Anschluss/Anschlüsse gefunden.`,
        es: `Conectado a Datadis: ${n} suministro(s) encontrado(s).`,
      };
    } catch (err) {
      logger.warn(`Connection test failed (${err.message})`);
      return errorMessage(err instanceof DatadisError ? err.reason : 'unavailable');
    }
  },

  // Read everything that can have changed now, whatever the schedule.
  async refresh_now(_gladys, { engine }) {
    logger.info('Action refresh_now');
    const result = await engine.sync({ force: true });
    if (!result.ok) {
      return errorMessage(result.reason);
    }
    const n = result.supplies;
    return {
      en: `Data refreshed for ${n} supply point(s).`,
      fr: `Données actualisées pour ${n} point(s) de livraison.`,
      de: `Daten für ${n} Anschluss/Anschlüsse aktualisiert.`,
      es: `Datos actualizados para ${n} suministro(s).`,
    };
  },
};
