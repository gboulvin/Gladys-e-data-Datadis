// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+), declared in the manifest
// `widgets` field and registered by index.js.
//
//   supply_overview   one supply (chosen in the widget settings): last day,
//                     current month, maximeter peak against the contracted
//                     power, the last 14 days as bars, contract details and a
//                     "Refresh" button
//   supplies_summary  every supply of the account at a glance, plus the
//                     state of the Datadis connection
//
// The content is declarative (the core renders it with its own theme), every
// text is a { en, fr, de, es } object, and `validateWidgetContent` checks it in
// test/widgets.test.js. The sync engine nudges both widgets after every sync.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { maskCups } from './datadis.js';
import { errorMessage } from './sync.js';
import { supplyName } from './devices/supply.js';

const logger = createLogger({ name: 'widgets' });

export const SUPPLY_OVERVIEW_WIDGET = 'supply_overview';
export const SUPPLIES_SUMMARY_WIDGET = 'supplies_summary';

export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

// The data moves once a day: the TTL is a safety net, the sync nudges.
const TTL_SECONDS = 1800;

const T = {
  lastDay: { en: 'Last day', fr: 'Dernier jour', de: 'Letzter Tag', es: 'Último día' },
  thisMonth: { en: 'This month', fr: 'Ce mois-ci', de: 'Dieser Monat', es: 'Este mes' },
  peak: { en: 'Peak power', fr: 'Puissance max.', de: 'Leistungsspitze', es: 'Potencia máxima' },
  dailyChart: {
    en: 'Daily consumption',
    fr: 'Consommation quotidienne',
    de: 'Täglicher Verbrauch',
    es: 'Consumo diario',
  },
  lastData: {
    en: 'Latest data',
    fr: 'Dernières données',
    de: 'Neueste Daten',
    es: 'Últimos datos',
  },
  distributor: { en: 'Distributor', fr: 'Distributeur', de: 'Netzbetreiber', es: 'Distribuidora' },
  marketer: { en: 'Supplier', fr: 'Fournisseur', de: 'Lieferant', es: 'Comercializadora' },
  contracted: {
    en: 'Contracted power',
    fr: 'Puissance souscrite',
    de: 'Vertragsleistung',
    es: 'Potencia contratada',
  },
  datadis: { en: 'Datadis', fr: 'Datadis', de: 'Datadis', es: 'Datadis' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartend', es: 'En espera' },
  none: { en: 'None yet', fr: 'Aucune', de: 'Noch keine', es: 'Ninguno' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  supplies: { en: 'Supplies', fr: 'Points de livraison', de: 'Anschlüsse', es: 'Suministros' },
  pickSupply: {
    en: 'Choose a supply in the widget settings.',
    fr: 'Choisissez un point de livraison dans les réglages du widget.',
    de: 'Wählen Sie einen Anschluss in den Widget-Einstellungen.',
    es: 'Elija un suministro en los ajustes del widget.',
  },
  noData: {
    en: 'No data yet: Datadis serves the readings of the previous days, check again tomorrow.',
    fr: 'Pas encore de données : Datadis fournit les relevés des jours précédents, revenez demain.',
    de: 'Noch keine Daten: Datadis liefert die Messwerte der Vortage, schauen Sie morgen wieder vorbei.',
    es: 'Aún no hay datos: Datadis ofrece las lecturas de los días anteriores, vuelva mañana.',
  },
  noSupply: {
    en: 'No supply found on the Datadis account yet.',
    fr: 'Aucun point de livraison trouvé sur le compte Datadis pour le moment.',
    de: 'Noch kein Anschluss im Datadis-Konto gefunden.',
    es: 'Aún no se ha encontrado ningún suministro en la cuenta de Datadis.',
  },
};

function refreshButton() {
  return {
    type: 'button',
    label: T.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  };
}

function connectionItem(engine) {
  const { ok, reason } = engine.status;
  if (ok === true) {
    return { label: T.datadis, icon: 'cloud', value: T.connected, color: WIDGET_COLORS.SUCCESS };
  }
  if (ok === false) {
    return {
      label: T.datadis,
      icon: 'cloud-off',
      value: reason === 'rate_limit' ? T.waiting : T.error,
      color: reason === 'rate_limit' ? WIDGET_COLORS.WARNING : WIDGET_COLORS.DANGER,
    };
  }
  return { label: T.datadis, icon: 'cloud', value: T.waiting, color: WIDGET_COLORS.NEUTRAL };
}

const kw = (value) => Number(value.toFixed(2));

function peakColor(summary) {
  if (summary.month_peak_kw === null || !summary.contracted_power_kw) {
    return WIDGET_COLORS.PRIMARY;
  }
  const ratio = summary.month_peak_kw / summary.contracted_power_kw;
  if (ratio >= 1) {
    return WIDGET_COLORS.DANGER;
  }
  return ratio >= 0.9 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
}

function supplyOverview(engine, entry) {
  const summary = engine.summary(entry);
  const components = [];
  if (!summary.last_day && summary.month_kwh === null) {
    components.push({ type: 'text', variant: 'body', text: T.noData });
  }
  components.push(
    {
      type: 'value',
      label: T.lastDay,
      icon: 'zap',
      value: summary.last_day_kwh ?? '-',
      unit: 'kWh',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: T.thisMonth,
      icon: 'calendar',
      value: summary.month_kwh ?? '-',
      unit: 'kWh',
      color: WIDGET_COLORS.INFO,
    },
  );
  if (summary.contracted_power_kw) {
    components.push({
      type: 'gauge',
      label: T.peak,
      value: kw(summary.month_peak_kw ?? 0),
      min: 0,
      max: kw(Math.max(summary.contracted_power_kw, summary.month_peak_kw ?? 0)),
      unit: 'kW',
      color: peakColor(summary),
    });
  } else {
    components.push({
      type: 'value',
      label: T.peak,
      icon: 'activity',
      value: summary.month_peak_kw === null ? '-' : kw(summary.month_peak_kw),
      unit: 'kW',
    });
  }
  if (summary.recent.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: T.dailyChart,
      unit: 'kWh',
      series: [
        {
          name: T.dailyChart,
          points: summary.recent.map(({ date, kwh }) => ({ t: `${date}T12:00:00Z`, v: kwh })),
        },
      ],
    });
  }
  const items = [
    {
      label: T.lastData,
      icon: 'clock',
      value: summary.last_data_date ?? T.none,
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: T.distributor,
      icon: 'git-branch',
      value: entry.supply.distributor || '-',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (entry.contract?.marketer) {
    items.push({
      label: T.marketer,
      icon: 'briefcase',
      value: entry.contract.marketer.slice(0, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (summary.contracted_power_kw) {
    items.push({
      label: T.contracted,
      icon: 'sliders',
      value: `${kw(summary.contracted_power_kw)} kW`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push(connectionItem(engine));
  components.push({ type: 'status', items }, refreshButton());
  return components;
}

function suppliesSummary(engine) {
  const entries = engine.store.entries();
  const components = [];
  if (entries.length === 0) {
    components.push({ type: 'text', variant: 'body', text: T.noSupply });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: entries.slice(0, 8).map((entry) => {
        const summary = engine.summary(entry);
        const subtitle = [maskCups(entry.supply.cups), entry.supply.distributor]
          .filter(Boolean)
          .join(' · ');
        const item = {
          title: supplyName(entry.supply).slice(0, 60),
          subtitle,
        };
        if (summary.last_day) {
          item.date = summary.last_day;
          item.badge = {
            text: `${Number(summary.last_day_kwh.toFixed(1))} kWh`.slice(0, 16),
            color: WIDGET_COLORS.PRIMARY,
          };
        }
        return item;
      }),
    });
  }
  const status = engine.status.ok === false ? errorMessage(engine.status.reason) : null;
  components.push({
    type: 'status',
    items: [
      connectionItem(engine),
      {
        label: T.supplies,
        icon: 'home',
        value: entries.length,
        color: WIDGET_COLORS.NEUTRAL,
      },
    ],
  });
  if (status) {
    components.push({ type: 'text', variant: 'caption', text: truncateTexts(status, 80) });
  }
  components.push(refreshButton());
  return components;
}

function truncateTexts(texts, max) {
  return Object.fromEntries(
    Object.entries(texts).map(([lang, text]) => [
      lang,
      text.length > max ? `${text.slice(0, max - 1)}…` : text,
    ]),
  );
}

async function refreshAction(engine, actionKey) {
  if (actionKey !== WIDGET_ACTIONS.REFRESH) {
    // Throwing acks the action as failed: the message reaches the user.
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  const result = await engine.sync({ force: true });
  if (result.ok) {
    return {
      en: 'Datadis data refreshed.',
      fr: 'Données Datadis actualisées.',
      de: 'Datadis-Daten aktualisiert.',
      es: 'Datos de Datadis actualizados.',
    };
  }
  return errorMessage(result.reason);
}

export const WIDGETS = {
  [SUPPLY_OVERVIEW_WIDGET]: {
    async get(_gladys, { settings, engine }) {
      logger.debug(`onWidgetGet <- ${SUPPLY_OVERVIEW_WIDGET}`);
      const entry = settings?.device ? engine.entryByDevice(settings.device) : null;
      return {
        ttl_seconds: TTL_SECONDS,
        components: entry
          ? supplyOverview(engine, entry)
          : [{ type: 'text', variant: 'body', text: T.pickSupply }],
      };
    },
    async action(_gladys, { actionKey, engine }) {
      logger.info(`onWidgetAction <- ${SUPPLY_OVERVIEW_WIDGET}.${actionKey}`);
      return refreshAction(engine, actionKey);
    },
  },

  [SUPPLIES_SUMMARY_WIDGET]: {
    async get(_gladys, { engine }) {
      logger.debug(`onWidgetGet <- ${SUPPLIES_SUMMARY_WIDGET}`);
      return { ttl_seconds: TTL_SECONDS, components: suppliesSummary(engine) };
    },
    async action(_gladys, { actionKey, engine }) {
      logger.info(`onWidgetAction <- ${SUPPLIES_SUMMARY_WIDGET}.${actionKey}`);
      return refreshAction(engine, actionKey);
    },
  },
};

/**
 * Freshness nudge for every widget (after a sync, a config update, a
 * reconnection). Fire-and-forget, rate-limited core-side.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
