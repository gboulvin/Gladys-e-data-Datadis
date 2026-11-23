# e-data (Datadis)

Cette intégration amène dans Gladys les points de livraison électriques d'un
compte [Datadis](https://datadis.es). Datadis est la plateforme gratuite des
distributeurs d'électricité espagnols (i-DE, e-distribución, UFD, E-redes,
Viesgo…) : elle fournit la consommation horaire, le maximètre et le contrat de
chaque point de livraison (CUPS) d'un titulaire.

C'est une intégration **cloud** : elle ne fait que lire Datadis par Internet.
Rien n'est piloté, et les relevés arrivent avec **un ou deux jours de
décalage** (c'est le fonctionnement de Datadis : les données d'une journée sont
publiées les jours suivants).

## Avant de commencer

1. Créez un compte sur [datadis.es](https://datadis.es/register) avec le
   NIF/NIE du titulaire du contrat (un compte « particulier » suffit).
2. Connectez-vous une fois sur datadis.es et vérifiez que vos points de
   livraison sont listés.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Saisissez votre **identifiant (NIF/NIE)** et votre **mot de passe** Datadis.
3. Facultatif : **NIF autorisé** — uniquement pour lire les compteurs d'un
   autre titulaire qui a autorisé votre compte sur Datadis.
4. Réglages facultatifs :
   - **Intervalle de rafraîchissement** (heures, 12 par défaut, 6 minimum) :
     fréquence de lecture de Datadis, qui refuse les requêtes identiques trop
     fréquentes.
   - **Historique à importer** (mois, 3 par défaut, jusqu'à 24) : lu à la
     première synchronisation d'un compteur.
   - **Consommation quotidienne élevée** (kWh, 0 = désactivé) : seuil du
     déclencheur de scène du même nom.
   - **Alarme de pic de puissance** (% de la puissance souscrite, 90 par
     défaut).
5. Enregistrez, puis cliquez sur **Tester la connexion** : le nombre de
   compteurs trouvés s'affiche.
6. Vos compteurs apparaissent dans l'onglet **Découverte** : ajoutez-les.

## Ce que vous obtenez

Un appareil par point de livraison, nommé d'après son adresse, avec :

| Fonctionnalité               | Description                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Consommation                 | Consommation horaire datée, intégrée au suivi énergétique de Gladys (coûts, graphiques) |
| Consommation du dernier jour | Total du dernier jour complet (kWh)                                                     |
| Consommation du mois         | Total du mois en cours (kWh)                                                            |
| Puissance max. du mois       | Pic le plus élevé du maximètre sur le mois (W)                                          |
| Puissance souscrite          | Puissance souscrite la plus élevée du contrat (W)                                       |
| Date des dernières données   | Date du relevé le plus récent                                                           |

## Actions

- **Tester la connexion** — se connecte et liste les compteurs, sans lire la
  consommation.
- **Actualiser les données maintenant** — lit Datadis immédiatement.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes (Gladys 5.1 ou
plus récent) :

Déclencheurs :

- **Nouvelles données quotidiennes** — Datadis a fourni une nouvelle journée
  complète. Variables : `{{triggerEvent.data.date}}`,
  `{{triggerEvent.data.consumption_kwh}}`.
- **Consommation quotidienne élevée** — une journée a dépassé le seuil
  configuré. Variables : `date`, `consumption_kwh`, `threshold_kwh`.
- **Alarme de pic de puissance** — le maximètre a enregistré un pic atteignant
  la part configurée de la puissance souscrite (risque de disjonction de l'ICP
  ou de pénalités de dépassement). Variables : `date`, `time`, `max_power_w`,
  `contracted_power_w`, `percent`.
- **Erreur Datadis** — Datadis n'a pas pu être lu (identifiants refusés,
  limite de requêtes, service indisponible). Variables : `reason`, `message`.

Chaque déclencheur peut être limité à un compteur (ou à une cause d'erreur).

Actions :

- **Actualiser les données Datadis** — lit Datadis maintenant. Sorties :
  `success`, `supplies`.
- **Obtenir la consommation** — consommation d'un compteur sur une période
  (dernier jour disponible, 7 ou 30 derniers jours, mois en cours ou
  précédent). Sorties : `consumption_kwh`, `days`, `start_date`, `end_date`,
  `max_power_w` — utilisez-les dans un message pour recevoir un bilan
  hebdomadaire ou mensuel.

## Tableau de bord

- **Compteur électrique** — un compteur : dernier jour, mois en cours, jauge
  de puissance max. face à la puissance souscrite, les 14 derniers jours en
  barres, distributeur, fournisseur et état de la connexion, avec un bouton
  **Actualiser**.
- **Compteurs Datadis** — tous les compteurs du compte et l'état de la
  connexion.

## Dépannage

- **« Datadis a refusé l'identifiant ou le mot de passe »** : vérifiez vos
  identifiants sur datadis.es. L'identifiant est le NIF/NIE, en majuscules.
- **« Datadis limite le nombre de requêtes »** : Datadis a refusé les requêtes
  temporairement ; l'intégration réessaie plus tard toute seule.
- **Pas de données pour hier** : normal, les distributeurs publient les relevés
  avec un ou deux jours de décalage (parfois plus).
- Logs : ouvrez les logs de l'intégration depuis Gladys (`LOG_LEVEL=debug`
  pour le détail complet). Les mots de passe, jetons et CUPS complets ne sont
  jamais journalisés.

## Confidentialité

L'intégration ne communique qu'avec datadis.es. Elle garde un cache des
relevés dans son propre volume `/data` (jamais le mot de passe) pour ne rien
relire après un redémarrage.
