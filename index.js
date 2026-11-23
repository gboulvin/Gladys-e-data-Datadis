// -----------------------------------------------------------------------------
// Entry point of the e-data (Datadis) Gladys integration.
//
// Role of this file: wire the SDK to the sync engine. It holds no Datadis
// logic; it only:
//   1. instantiates the SDK (connection, auth, reconnection: handled by it);
//   2. registers the handlers BEFORE connect();
//   3. connects, then starts the sync scheduler.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { hasCredentials, normalizeConfig } from './src/config.js';
import { Store } from './src/store.js';
import { SyncEngine, errorMessage } from './src/sync.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();
const store = new Store();
const engine = new SyncEngine({ gladys, store, onUpdate: () => refreshWidgets(gladys) });

let config = normalizeConfig();
engine.setConfig(config);

// --- Discovery: one device per supply (CUPS) known from Datadis --------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the supplies');
  await gladys.publishDiscoveredDevices(engine.buildDevices());
  // No supply known yet: read Datadis in the background, the sync publishes
  // the supplies as soon as it lists them.
  if (engine.supplies().length === 0 && hasCredentials(config)) {
    engine.sync({ force: true }).catch((err) => logger.error('Sync failed', err));
  }
});

// --- A supply was added: give it the data already read -----------------------
gladys.onDeviceCreated(async (device) => {
  const entry = engine.entryByDevice(device.external_id);
  if (entry) {
    logger.info('A supply was created: publishing its cached data');
    await engine.publishSupply(entry, { all: true });
    await store.save();
  }
});

// Every feature is a read-only measurement: nothing to command.
gladys.onSetValue(async (device) => {
  throw new Error(`${device.external_id} has no controllable feature`);
});

// --- Manifest actions (Configuration screen buttons) -------------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) =>
    handler(gladys, { fields, config, engine, createClient: engine.createClient }),
  );
}

// --- Scene actions -----------------------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(gladys, { fields, config, engine }));
}

// --- Dashboard widgets -------------------------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, config, engine }));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, config, engine }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  const credentialsChanged = engine.setConfig(config);
  if (!hasCredentials(config)) {
    await gladys.setConnectionStatus(false, errorMessage('credentials'));
  } else if (credentialsChanged) {
    // New credentials: check them and read the supplies right away, in the
    // background (a first import reads several months).
    engine.sync({ force: true }).catch((err) => logger.error('Sync failed', err));
  } else {
    // Thresholds changed: re-evaluate nothing retroactively, just redraw.
    refreshWidgets(gladys);
  }
  await gladys.publishDiscoveredDevices(engine.buildDevices());
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    engine.setConfig(config);
    await gladys.publishDiscoveredDevices(engine.buildDevices());
    if (!hasCredentials(config)) {
      await gladys.setConnectionStatus(false, errorMessage('credentials'));
    } else {
      // Re-publish what is cached (the dashboards were closed meanwhile),
      // then read Datadis if a sync is due.
      await engine.publishAll();
      if (engine.isDue()) {
        engine.sync().catch((err) => logger.error('Initial sync failed', err));
      } else {
        await gladys.setConnectionStatus(engine.status.ok !== false);
      }
    }
    refreshWidgets(gladys);
    engine.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  engine.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  engine.stop();
  await store.save();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the e-data (Datadis) integration...');
await store.load();
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
