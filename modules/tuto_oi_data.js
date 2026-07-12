/* ============================================================================
 * OI - ADI — données du tutoriel interactif (généré, ne pas éditer à la main).
 * Alimente le moteur autonome modules/tuto-engine.js (window.PocheTuto).
 * Les libellés du champ "terms" et les citations de "body" sont VERBATIM
 * (repris exactement de l'interface).
 * ==========================================================================*/
(function () {
  'use strict';
  function boot() {
    if (!window.PocheTuto || !window.PocheTuto.mount) {
      console.warn('[Tuto] moteur tuto-engine.js absent — tutoriel désactivé.');
      return;
    }
    window.PocheTuto.mount({
      appId: "oi",
      appName: "OI - ADI",
      accent: "#4f8dff",
      buttonLabel: "Tuto",
      // Le bouton s'intègre dans le dock flottant natif de la page (#dockMenu).
      dock: {
        selector: '#dockMenu',
        itemTag: 'div',
        itemClass: 'dock-menu-item',
        icon: 'menu_book',
        title: "Tutoriel interactif — OI - ADI",
        insertAfter: '#dockToggleBtn'
      },
      data: {
        "intro": {
          "title": "Bienvenue dans OI - ADI",
          "text": "OI - ADI vous accompagne dans la rédaction complète d'un ordre initial : situation, adversaires, articulation tactique, PATRACDVR, cartographie et photos annotées. Ce tutoriel vous guide pas à pas, du dock d'actions globales jusqu'à l'export PDF de votre dossier. Chaque étape pointe le bouton ou le champ réel de l'interface."
        },
        "chapters": [
          {
            "id": "prise-en-main-actions-globales",
            "icon": "dashboard",
            "title": "Prise en main & actions globales",
            "summary": "La barre dock flottante et ses actions transverses : PCTAC, cartographie, archive, réinitialisation, thème et notifications.",
            "steps": [
              {
                "title": "Repérer la barre dock flottante",
                "body": "La barre dock (bloc id=\"dockMenu\") est le menu flottant qui regroupe toutes les actions globales de l'application, disponibles depuis n'importe quelle étape du formulaire. Chaque icône est un bouton avec une infobulle (attribut title) décrivant son rôle au survol.",
                "terms": [
                  "Réduire/Agrandir",
                  "Accéder à PCTAC",
                  "Cartographie (préparation mission)",
                  "Importer une archive (.oi.zip ou .json)",
                  "Réinitialiser",
                  "Changer le thème"
                ],
                "selector": "#dockMenu",
                "tip": "Passez le curseur sur chaque icône pour lire son infobulle avant de cliquer."
              },
              {
                "title": "Réduire ou agrandir le dock",
                "body": "Le premier bouton du dock (icône chevron, id=\"dockToggleBtn\", infobulle \"Réduire/Agrandir\") replie ou déplie la barre. L'icône passe de expand_more (dock déplié) à expand_less (dock replié) et l'état est mémorisé (clé dockCollapsed) : le dock reste dans le même état au prochain chargement.",
                "terms": [
                  "Réduire/Agrandir"
                ],
                "selector": "#dockToggleBtn",
                "tip": "Une fois replié, seul ce bouton chevron reste visible ; recliquez dessus pour ré-afficher toutes les actions."
              },
              {
                "title": "Accéder à PCTAC",
                "body": "Le bouton \"Accéder à PCTAC\" (icône alt_route, id=\"pctacLink\") est un lien qui ouvre la page pctac.html (poste de commandement tactique / cartographie opérationnelle). C'est un vrai lien de navigation, pas une modale : il quitte le formulaire d'OI en cours.",
                "terms": [
                  "Accéder à PCTAC"
                ],
                "selector": "#pctacLink",
                "tip": "Pensez à sauvegarder ou exporter votre travail avant de quitter, la navigation change de page."
              },
              {
                "title": "Ouvrir la Cartographie (préparation mission)",
                "body": "Le bouton \"Cartographie (préparation mission)\" (icône map, id=\"cartographyBtn\") ouvre la modale de cartographie intégrée (carte MapLibre : pings, dessins, captures) sans quitter le formulaire. Si la librairie cartographique n'est pas chargée (hors réseau), un message d'alerte s'affiche : \"Librairie cartographique indisponible (réseau ?). Réessayez en ligne.\".",
                "terms": [
                  "Cartographie (préparation mission)",
                  "Librairie cartographique indisponible (réseau ?). Réessayez en ligne."
                ],
                "selector": "#cartographyBtn",
                "tip": "Une capture de la carte peut être renvoyée vers un champ photo (toast \"Capture de carte ajoutée au champ photo.\")."
              },
              {
                "title": "Exporter TOUT en archive .oi.zip",
                "body": "Le bouton d'export (icône folder_zip, id=\"exportArchiveBtn\", infobulle \"Exporter TOUT (archive .oi.zip : champs + photos + carto)\") génère un fichier unique nommé OI-Archive-{horodatage}.oi.zip contenant les champs, les photos HD et la cartographie. À la fin, un toast de succès confirme : \"Archive exportée ({n} photos)\".",
                "terms": [
                  "Exporter TOUT (archive .oi.zip : champs + photos + carto)",
                  "Archive exportée ({n} photos)"
                ],
                "selector": "#exportArchiveBtn",
                "tip": "L'export force d'abord une sauvegarde immédiate de tous les champs ; c'est le format recommandé pour transférer un dossier complet."
              },
              {
                "title": "Importer une archive et choisir quoi restaurer",
                "body": "Le bouton d'import (icône unarchive, id=\"importArchiveBtn\", infobulle \"Importer une archive (.oi.zip ou .json)\") ouvre le sélecteur de fichier (accepte .oi.zip et anciennes sessions .json). L'archive lue, la modale \"Importer une archive\" liste les catégories détectées, chacune précochée : \"Champs texte (situation, mission, environnement…)\", \"Adversaires\", \"Photos HD (annotations, légendes)\", \"Membres PATRACDVR (+ Configuration Unité)\", \"Articulation MOICP / ZMSPCP / Effraction\", \"Cartographie (carte, pings, dessins)\". Cochez \"Tout importer\" pour tout sélectionner, puis validez avec \"Importer la sélection\" ou abandonnez avec \"Annuler\".",
                "terms": [
                  "Importer une archive (.oi.zip ou .json)",
                  "Importer une archive",
                  "Tout importer",
                  "Champs texte (situation, mission, environnement…)",
                  "Adversaires",
                  "Photos HD (annotations, légendes)",
                  "Membres PATRACDVR (+ Configuration Unité)",
                  "Articulation MOICP / ZMSPCP / Effraction",
                  "Cartographie (carte, pings, dessins)",
                  "Annuler",
                  "Importer la sélection"
                ],
                "selector": "#importArchiveBtn",
                "tip": "Les éléments non cochés ne sont pas modifiés (fusion non destructive) ; après validation, un message \"Import effectué : {catégories}. Rechargement…\" recharge la page."
              },
              {
                "title": "Réinitialiser (Page Active ou Tout)",
                "body": "Le bouton \"Réinitialiser\" (icône restart_alt, id=\"resetMenuBtn\") ouvre la modale \"Réinitialisation\" qui demande \"Que souhaitez-vous réinitialiser ?\". Le bouton \"Page Active\" (icône restart_alt) vide uniquement l'étape courante après confirmation, puis affiche le toast \"Page réinitialisée\". Le bouton \"Tout\" (icône delete_sweep, en rouge) efface tout le formulaire (la configuration PATRAC est conservée) et affiche \"Application réinitialisée (Personnel conservé)\".",
                "terms": [
                  "Réinitialiser",
                  "Réinitialisation",
                  "Que souhaitez-vous réinitialiser ?",
                  "Page Active",
                  "Tout",
                  "Réinitialiser uniquement les champs de la page active ?",
                  "Page réinitialisée",
                  "Application réinitialisée (Personnel conservé)"
                ],
                "selector": "#resetMenuBtn",
                "tip": "Le PATRACDVR ne se réinitialise pas ici : le toast \"Le PATRACDVR ne peut être réinitialisé que via son bouton dédié.\" vous renvoie vers son bouton propre."
              },
              {
                "title": "Changer le thème (clair / sombre)",
                "body": "Le dernier bouton du dock \"Changer le thème\" (id=\"darkModeToggle\") bascule entre le mode sombre (dark-mode) et le mode clair (light-mode). L'icône reflète l'état : nightlight en mode sombre, clear_day en mode clair. Le choix est mémorisé (clé theme) ; par défaut l'application démarre en mode sombre.",
                "terms": [
                  "Changer le thème"
                ],
                "selector": "#darkModeToggle",
                "tip": "Le thème est conservé d'une session à l'autre, y compris après un rechargement."
              },
              {
                "title": "Comprendre les notifications (toasts)",
                "body": "Les actions globales confirment leur résultat par des notifications (toasts) qui apparaissent en bas à droite de l'écran et disparaissent seules après quelques secondes. Elles se déclinent en quatre types visuels : succès (icône check_circle, bord vert), erreur (icône error, bord rouge), avertissement (icône warning, bord doré) et information (icône info, bord bleu).",
                "terms": [
                  "Archive exportée ({n} photos)",
                  "Page réinitialisée",
                  "Application réinitialisée (Personnel conservé)"
                ],
                "selector": null,
                "tip": "Les toasts remplacent les anciennes fenêtres bloquantes : ils n'interrompent pas votre saisie et n'exigent aucun clic pour se fermer."
              }
            ]
          },
          {
            "id": "rediger-ordre-initial",
            "icon": "description",
            "title": "Rédiger l'ordre initial",
            "summary": "Remplir les rubriques narratives de l'OI, étape par étape, avec sauvegarde automatique.",
            "steps": [
              {
                "title": "Renseigner la Situation",
                "body": "Étape « 1. Situation » : saisissez la « Date de l'opération: » puis détaillez le contexte dans les zones de texte « 1.1 Générale: » et « 1.2 Particulière: ». Chaque frappe déclenche la sauvegarde automatique.",
                "terms": [
                  "1. Situation",
                  "Date de l'opération:",
                  "1.1 Générale:",
                  "1.2 Particulière:"
                ],
                "selector": "#situation_generale",
                "tip": "Rien à sauvegarder manuellement : chaque saisie est enregistrée en local, y compris à la fermeture de l'onglet."
              },
              {
                "title": "Décrire l'Environnement",
                "body": "Étape « 3. Environnement » : complétez « Ami(e)s (Unités en soutien): », « Terrain / Météo: », « Éclairage: », « Lever du soleil (Heure prévisionnelle): », « Population: », « Faune / Animaux: », « Accès Principal: », « Cheminement initial: » et « Cadre juridique: ».",
                "terms": [
                  "3. Environnement",
                  "Ami(e)s (Unités en soutien):",
                  "Terrain / Météo:",
                  "Éclairage:",
                  "Lever du soleil (Heure prévisionnelle):",
                  "Population:",
                  "Faune / Animaux:",
                  "Accès Principal:",
                  "Cheminement initial:",
                  "Cadre juridique:"
                ],
                "selector": "#amies",
                "tip": null
              },
              {
                "title": "Rédiger la Mission de l'unité",
                "body": "Étape « 4. Mission de l'unité » : la zone de texte est pré-remplie avec « INTERPELLER L'OBJECTIF. », « ASSISTER LORS DE LA PERQUISITION. » et « CONDUITE AU LIEU DE GAV. ». Adaptez ce texte à votre mission.",
                "terms": [
                  "4. Mission de l'unité",
                  "INTERPELLER L'OBJECTIF.",
                  "ASSISTER LORS DE LA PERQUISITION.",
                  "CONDUITE AU LIEU DE GAV."
                ],
                "selector": "#missions_psig",
                "tip": null
              },
              {
                "title": "Cadrer l'Exécution",
                "body": "Étape « 5. Exécution » : indiquez « Date d'exécution: » et « Heure d'exécution (H): » (06:00 par défaut), puis rédigez le « Corps de la mission (Exécution): » dans la grande zone de texte déjà pré-remplie.",
                "terms": [
                  "5. Exécution",
                  "Date d'exécution:",
                  "Heure d'exécution (H):",
                  "Corps de la mission (Exécution):"
                ],
                "selector": "#action_body_text",
                "tip": null
              },
              {
                "title": "Construire la Chronologie",
                "body": "Sous « Chronologie », le bouton « Ajouter Événement » insère une ligne : un type (liste « T0 » à « T5 »), une heure, et une « Description ». Les cinq premières lignes sont pré-remplies (« Rasso PSIG », « Départ PR », « Départ LE », « MEP TERMINÉ », « TOP ACTION »).",
                "terms": [
                  "Chronologie",
                  "Ajouter Événement",
                  "T0",
                  "T5",
                  "Description",
                  "Rasso PSIG",
                  "Départ PR",
                  "Départ LE",
                  "MEP TERMINÉ",
                  "TOP ACTION"
                ],
                "selector": "#time_events_container",
                "tip": "Chaque ligne est déplaçable (draggable) : glissez-la pour réordonner la chronologie ; la croix la supprime."
              },
              {
                "title": "Lister Hypothèses et Cheminement",
                "body": "Sous « Hypothèses », « Créer Hypothèse » ajoute un champ « Saisir une hypothèse... ». Plus bas, la rubrique « Cheminement » propose les boutons photo « Transport PSIG → PR » et « Transport PR → Domicile/LE ».",
                "terms": [
                  "Hypothèses",
                  "Créer Hypothèse",
                  "Saisir une hypothèse...",
                  "Cheminement",
                  "Transport PSIG → PR",
                  "Transport PR → Domicile/LE"
                ],
                "selector": "#hypotheses_container",
                "tip": null
              },
              {
                "title": "Finaliser et vérifier la cohérence",
                "body": "Étape « 8. Finalisation & Conduites à tenir » : renseignez « Trigramme Rédacteur (ex: ABC): » et « Unité (ex: PSIG ...): », ajustez « Conduites à tenir (CAT) Générales », « NO GO » et « Liaison ». Le bouton « Aperçu (Mode Présentation) » lance la « Vérification des Données Critiques ».",
                "terms": [
                  "8. Finalisation & Conduites à tenir",
                  "Trigramme Rédacteur (ex: ABC):",
                  "Unité (ex: PSIG ...):",
                  "Conduites à tenir (CAT) Générales",
                  "NO GO",
                  "Liaison",
                  "Aperçu (Mode Présentation)",
                  "Vérification des Données Critiques"
                ],
                "selector": "#previewBtn",
                "tip": "La rubrique repliable « Fond PDF Personnalisé » remplace le fond via « 📂 Choisir Image » ou « Rétablir Défaut »."
              }
            ]
          },
          {
            "id": "fiches-adversaires",
            "icon": "person",
            "title": "Fiches adversaires",
            "summary": "Créer et documenter chaque adversaire : identité, évaluation de la menace, moyens et photos de signalement.",
            "steps": [
              {
                "title": "Créer une fiche adversaire",
                "body": "Étape « 2. Adversaire(s) » : le bouton « Créer Adversaire » ajoute une fiche repliable titrée « Adversaire », qui devient « Adversaire: {nom} » dès que vous saisissez le nom. La croix de la fiche demande « Supprimer définitivement cette fiche adversaire ? ».",
                "terms": [
                  "2. Adversaire(s)",
                  "Créer Adversaire",
                  "Adversaire",
                  "Adversaire: {nom}",
                  "Supprimer définitivement cette fiche adversaire ?"
                ],
                "selector": "#createAdversaryBtn",
                "tip": null
              },
              {
                "title": "Ajouter photos & signalement",
                "body": "Dans la fiche, la section repliable « Photos & signalement » (bouton « replier » / « déplier ») permet de charger « Photo principale », « Photos supplémentaires » et, sous « Renforts potentiels : », des « Photo(s) renforts ».",
                "terms": [
                  "Photos & signalement",
                  "replier",
                  "déplier",
                  "Photo principale",
                  "Photos supplémentaires",
                  "Renforts potentiels :",
                  "Photo(s) renforts"
                ],
                "selector": "#adversaries_container",
                "tip": "« Photos supplémentaires » et « Photo(s) renforts » acceptent plusieurs fichiers ; « Photo principale » n'en conserve qu'une."
              },
              {
                "title": "Renseigner l'Identité",
                "body": "La section « Identité » regroupe « Nom / Prénom : », « Naissance : » (date + « Lieu de naissance »), « Stature / Ethnie : » avec la liste « Ethnie » (« Caucasien », « Nord africain », « Afro-antillais », « Asiatique »), « Signes particuliers : », « Situation familiale : », « Profession : » et « Domicile : ».",
                "terms": [
                  "Identité",
                  "Nom / Prénom :",
                  "Naissance :",
                  "Lieu de naissance",
                  "Stature / Ethnie :",
                  "Ethnie",
                  "Caucasien",
                  "Nord africain",
                  "Afro-antillais",
                  "Asiatique",
                  "Signes particuliers :",
                  "Situation familiale :",
                  "Profession :",
                  "Domicile :"
                ],
                "selector": "#adversaries_container",
                "tip": null
              },
              {
                "title": "Évaluer la menace",
                "body": "La section « Évaluation de la menace » contient « Antécédents : », les puces « État d'esprit : » (« Serein », « Hostile », « Conciliant », « Sur ses gardes »), « Attitude connue : », les puces « Volume (renfort) : » (« Seul », « Famille », « BO », « Conjointe », « 2-3 », « 4+ »), « Substances : » et « Armes connues : ».",
                "terms": [
                  "Évaluation de la menace",
                  "Antécédents :",
                  "État d'esprit :",
                  "Serein",
                  "Hostile",
                  "Conciliant",
                  "Sur ses gardes",
                  "Attitude connue :",
                  "Volume (renfort) :",
                  "Seul",
                  "Famille",
                  "BO",
                  "Conjointe",
                  "2-3",
                  "4+",
                  "Substances :",
                  "Armes connues :"
                ],
                "selector": "#adversaries_container",
                "tip": "Chaque groupe de puces accepte une valeur libre via le champ « Ajouter personnalisé (entrée) »."
              },
              {
                "title": "Moyens & véhicules de l'adversaire",
                "body": "La section « Moyens & véhicules » liste les « Moyens employés (ME) : » via le bouton « Moyen employé » (3 maximum en saisie), et les « Véhicules : » via le bouton « Véhicule ». La croix retire une ligne.",
                "terms": [
                  "Moyens & véhicules",
                  "Moyens employés (ME) :",
                  "Moyen employé",
                  "Véhicules :",
                  "Véhicule"
                ],
                "selector": "#adversaries_container",
                "tip": "Les véhicules saisis ici alimentent les pins « VL Target » de la cartographie."
              }
            ]
          },
          {
            "id": "articulation-effraction",
            "icon": "account_tree",
            "title": "Articulation tactique & effraction",
            "summary": "Structurer la manœuvre en blocs MOICP / ZMSPCP et détailler les cellules d'effraction avec leurs outils.",
            "steps": [
              {
                "title": "Articuler MOICP / ZMSPCP",
                "body": "Étape « 6. Articulation » : « Créer MOICP » ajoute un bloc « Inter {n} » (« Mission (M): », « Objectif (O): », « Itinéraire (I): », « Points Particuliers (P): », « Conduite à Tenir (C): », « Place du Chef (India): ») ; « Créer ZMSPCP » ajoute un bloc « Appui Observation {n} » (« Zone d'installation (Z): », « Secteur de surveillance (S): »…). Les membres sont auto-peuplés depuis le PATRACDVR et réordonnables par glisser.",
                "terms": [
                  "6. Articulation",
                  "Créer MOICP",
                  "Inter {n}",
                  "Mission (M):",
                  "Objectif (O):",
                  "Itinéraire (I):",
                  "Points Particuliers (P):",
                  "Conduite à Tenir (C):",
                  "Place du Chef (India):",
                  "Créer ZMSPCP",
                  "Appui Observation {n}",
                  "Zone d'installation (Z):",
                  "Secteur de surveillance (S):"
                ],
                "selector": "#addMoicpBtn",
                "tip": "En haut de l'étape : « Place du Chef (Générale): » et les ordres repliables « Ordre de la rame VL », « Ordre de la colonne de progression », « Ordre de pénétration »."
              },
              {
                "title": "Cellule Effraction et outils",
                "body": "« Ajouter Cellule Effraction » crée un bloc « Effraction {n} » : « Mission EFFRAC : », « Type de porte : », « Structure & Dormant : », « Serrurerie : », « Environnement immédiat : », des mesures (« Bâti à Bâti (cm) », « Dormant à Dormant (cm) », « Hauteur de porte (cm) »…) et « Ajouter Hypothèse » (« Phase Effraction: », « Phase Dégagement: », « Phase Assaut: »). Sur chaque photo, « Outils Effraction » propose « Hydraulique », « Mécanique », « Autres » et « Outil Nouveau / Autre : ».",
                "terms": [
                  "Ajouter Cellule Effraction",
                  "Effraction {n}",
                  "Composition cellule EFFRAC",
                  "Mission EFFRAC :",
                  "Type de porte :",
                  "Structure & Dormant :",
                  "Serrurerie :",
                  "Environnement immédiat :",
                  "Bâti à Bâti (cm)",
                  "Dormant à Dormant (cm)",
                  "Hauteur de porte (cm)",
                  "Ajouter Hypothèse",
                  "Phase Effraction:",
                  "Phase Dégagement:",
                  "Phase Assaut:",
                  "Outils Effraction",
                  "Hydraulique",
                  "Mécanique",
                  "Autres",
                  "Outil Nouveau / Autre :"
                ],
                "selector": "#addEffractionBtn",
                "tip": "Outils proposés : « HDR50 », « DOOR », « OP71 » (Hydraulique) ; « Multy Pry », « Multi Sledge », « Mini Ram », « Bélier lourd », « Pied de biche », « Pince Monseigneur » (Mécanique) ; « Pass PTT », « VIGIK », « Double clé » (Autres)."
              }
            ]
          },
          {
            "id": "patracdvr-documents",
            "icon": "groups",
            "title": "PATRACDVR & documents",
            "summary": "Répartir le personnel et les véhicules, éditer les PAX, gérer les options de l'unité et générer le PDF du PATRACDVR.",
            "steps": [
              {
                "title": "Comprendre le PATRACDVR",
                "body": "L'étape \"7. PATRACDVR\" est le tableau de répartition du personnel (PAX) et des véhicules (VL) : chaque PAX est une pastille que l'on fait glisser entre \"Composition des véhicules (Cliquer sur le nom pour renommer)\" et \"Personnel à attribuer\". Cette répartition alimente automatiquement l'articulation (MOICP/ZMSPCP) et le PDF.",
                "selector": "#patracdvr_container",
                "terms": [
                  "7. PATRACDVR",
                  "Composition des véhicules (Cliquer sur le nom pour renommer)",
                  "Personnel à attribuer"
                ],
                "tip": "Un clic sur le nom d'un véhicule ouvre l'invite \"Renommer le véhicule :\" pour le rebaptiser."
              },
              {
                "title": "Ajouter un VL ou un PAX",
                "body": "Sous \"Ajouter un VL ou un PAX\", le bouton \"Ajouter VL\" ouvre l'invite \"Veuillez saisir le nom du nouveau VL (ex: KODIAQ, SHARAN, VTC...):\" et crée une ligne véhicule ; \"Ajouter PAX\" ouvre \"Veuillez saisir le trigramme du nouveau PAX (ex: ABC):\" et crée une pastille dans \"Personnel à attribuer\".",
                "selector": "#addManualVehicleBtn",
                "terms": [
                  "Ajouter un VL ou un PAX",
                  "Ajouter VL",
                  "Veuillez saisir le nom du nouveau VL (ex: KODIAQ, SHARAN, VTC...):",
                  "Ajouter PAX",
                  "Veuillez saisir le trigramme du nouveau PAX (ex: ABC):",
                  "Personnel à attribuer"
                ],
                "tip": "Le trigramme doit faire 2 à 4 caractères, sinon l'alerte \"Le trigramme doit contenir entre 2 et 4 caractères.\" s'affiche."
              },
              {
                "title": "Créer une cellule complète",
                "body": "Sous \"Créer une cellule (2 PAX minimum)\", les boutons \"Cellule India\", \"Cellule AO\" et \"Cellule Effraction\" créent une cellule entière d'un coup : l'invite demande les trigrammes \"(séparés par espace, virgule ou retour à la ligne — 2 minimum) :\" et pré-affecte les PAX au prochain numéro de cellule libre. Un toast \"Cellule {cellule} : {n} PAX ajouté(s)\" confirme.",
                "selector": "#cell_batch_buttons",
                "terms": [
                  "Créer une cellule (2 PAX minimum)",
                  "Cellule India",
                  "Cellule AO",
                  "Cellule Effraction",
                  "Cellule {cellule} : {n} PAX ajouté(s)"
                ],
                "tip": "En dessous de 2 PAX, l'alerte \"Une cellule comporte au moins 2 personnels.\" apparaît."
              },
              {
                "title": "Éditer un membre",
                "body": "Un clic sur une pastille PAX ouvre la fiche \"Membre :\" avec les champs \"Trigramme\" et \"DIR (CANAL)\", puis une liste d'attributs repliables (accordéons « Cellule », « Fonction », « Arme P. », « Arme S. », « A.F.I. », « Grenades », « Équip. 1 », « Équip. 2 », « Tenue », « GPB »). Chaque modification est auto-sauvegardée : la pastille \"Enregistré\" clignote.",
                "selector": null,
                "terms": [
                  "Membre :",
                  "Trigramme",
                  "Nouveau trigramme",
                  "DIR (CANAL)",
                  "Ex: 42, 101…",
                  "Cellule",
                  "Fonction",
                  "Arme P.",
                  "Arme S.",
                  "A.F.I.",
                  "Grenades",
                  "Équip. 1",
                  "Équip. 2",
                  "Tenue",
                  "GPB",
                  "Enregistré"
                ],
                "tip": "Le champ \"DIR (CANAL)\" (placeholder \"Ex: 42, 101…\") renseigne le canal radio du PAX, réutilisé dans l'articulation."
              },
              {
                "title": "Cloner ou supprimer un membre",
                "body": "Un clic droit (ou appui long sur mobile) sur une pastille PAX ouvre le menu \"Cloner\" / \"Supprimer\" : \"Cloner\" duplique le PAX (suffixe C au trigramme), \"Supprimer\" demande \"Supprimer définitivement le membre {trigramme} ?\". On peut aussi glisser une pastille sur la zone \"JETER ICI pour supprimer définitivement le membre.\".",
                "selector": "#trashCan",
                "terms": [
                  "Cloner",
                  "Supprimer",
                  "Supprimer définitivement le membre {trigramme} ?",
                  "JETER ICI pour supprimer définitivement le membre."
                ],
                "tip": "La corbeille \"JETER ICI pour supprimer définitivement le membre.\" s'active au survol pendant le glisser-déposer."
              },
              {
                "title": "Déplacer plusieurs PAX en lot",
                "body": "Le bouton \"Déplacement groupé\" active la sélection multiple : le compteur \"0 PAX sélectionné\" s'ajuste, \"Toute la cellule\" étend la sélection à la cellule entière, \"Déplacer vers…\" liste les véhicules cibles, \"Désattribuer\" renvoie les PAX vers \"Personnel à attribuer\" et \"Effacer\" vide la sélection.",
                "selector": "#patracBatchToggleBtn",
                "terms": [
                  "Déplacement groupé",
                  "0 PAX sélectionné",
                  "Toute la cellule",
                  "Déplacer vers…",
                  "Désattribuer",
                  "Effacer",
                  "Personnel à attribuer",
                  "Non affectés"
                ],
                "tip": "En mode groupé, un clic (dé)sélectionne la pastille au lieu d'ouvrir l'édition ; un toast \"{n} PAX déplacé(s).\" confirme le déplacement."
              },
              {
                "title": "Régler les options de l'unité",
                "body": "Le bouton \"Configuration Unité\" ouvre une fenêtre où chaque attribut (fonctions, cellules, armes, équipement, tenue…) se saisit en zone de texte : \"Une option par ligne ou séparée par des virgules.\". \"Enregistrer\" met à jour les boutons d'édition de membre et affiche le toast \"Configuration de l'unité enregistrée\".",
                "selector": "#openUniteConfigBtn",
                "terms": [
                  "Configuration Unité",
                  "Une option par ligne ou séparée par des virgules.",
                  "Enregistrer",
                  "Configuration de l'unité enregistrée"
                ],
                "tip": "Le bouton \"Retour\" ferme la fenêtre sans enregistrer les modifications."
              },
              {
                "title": "Générer le PDF du PATRACDVR",
                "body": "Le bouton \"PDF PATRACDVR\" (info-bulle \"Générer le PDF du PATRACDVR\") génère un tableau A4 paysage titré \"PATRACDVR\" (colonnes PAX, Fct, Cel., Arme P., Arme S., AFI, Gren., Equip 1, Equip 2, Tenue, GPB, DIR), regroupé par véhicule avec un bloc \"NON ASSIGNÉS\" pour le personnel non affecté, puis le télécharge sous \"PATRACDVR_{date}.pdf\". Un toast \"PDF PATRACDVR généré\" confirme.",
                "selector": "#patracdvrPdfBtn",
                "terms": [
                  "PDF PATRACDVR",
                  "Générer le PDF du PATRACDVR",
                  "PATRACDVR",
                  "NON ASSIGNÉS",
                  "PATRACDVR_{date}.pdf",
                  "PDF PATRACDVR généré"
                ],
                "tip": "Si aucun PAX n'est présent, le toast \"Aucun membre dans le PATRACDVR.\" s'affiche et aucun fichier n'est produit."
              },
              {
                "title": "Réinitialiser le PATRACDVR",
                "body": "Le bouton \"Réinitialiser\" (icône rouge) efface tout le personnel et les véhicules après la confirmation \"Voulez-vous vraiment réinitialiser tout le personnel et les véhicules du PATRACDVR ?\" ; un toast \"PATRACDVR réinitialisé\" confirme l'opération.",
                "selector": "#resetPatracdvrBtn",
                "terms": [
                  "Réinitialiser",
                  "Voulez-vous vraiment réinitialiser tout le personnel et les véhicules du PATRACDVR ?",
                  "PATRACDVR réinitialisé"
                ],
                "tip": "N'affecte que le PATRACDVR courant : le reste du formulaire de l'OI est conservé."
              }
            ]
          },
          {
            "id": "cartographie-mission",
            "icon": "map",
            "title": "Cartographie de mission",
            "summary": "Ouvrir la carte, chercher une adresse/GPS, poser des pins par catégorie, dessiner, capturer et exporter.",
            "steps": [
              {
                "title": "Ouvrir la cartographie",
                "body": "Dans le dock d'outils, le bouton \"Cartographie (préparation mission)\" (icône carte) ouvre la modale plein cadre. La carte satellite s'affiche avec, à droite, une barre verticale d'outils flottants (recherche, point, dessin, capture, libellés, 2D/3D, plein écran, fermer). Au premier chargement la vue est centrée sur la France, puis la carte réutilise votre dernier cadrage enregistré.",
                "terms": [
                  "Cartographie (préparation mission)"
                ],
                "selector": "#cartographyBtn",
                "tip": "La carte fait partie de la session OI : pins, dessins et cadrage sont inclus dans l'export/import."
              },
              {
                "title": "Rechercher une adresse ou des coordonnees GPS",
                "body": "Le bouton \"Recherche adresse / coordonnées GPS\" (loupe, en haut de la barre) déplie un bandeau avec le champ \"Adresse ou coordonnées GPS (lat, lng)\". Saisissez une adresse puis Entrée ou cliquez la loupe : jusqu'à 5 résultats s'affichent, un clic sur un résultat recentre la carte. Saisir des coordonnées décimales (ex. « 48.8566, 2.3522 ») recentre directement et affiche « Point GPS centré : {lat}, {lng} ».",
                "terms": [
                  "Recherche adresse / coordonnées GPS",
                  "Adresse ou coordonnées GPS (lat, lng)",
                  "Ex : « 12 rue de la Paix, Paris » ou « 48.8566, 2.3522 »",
                  "Point GPS centré : {lat}, {lng}"
                ],
                "selector": "#oi_carto_btn_search",
                "tip": "En cas de saturation du service, le message « Quota de recherche atteint. Réessayez dans un instant. » s'affiche."
              },
              {
                "title": "Ouvrir l'ajout de point et choisir une categorie",
                "body": "Le bouton \"Ajouter un point (membre ou pin OI)\" (icône add_location) ouvre la modale \"Ajouter un point\". Le champ \"Libellé personnalisé (appliqué aux pins génériques)\" en haut renomme les pins génériques que vous poserez. Cinq sections classent les points : \"Membres PATRACDVR\", \"Cyno\", \"Rame VL — véhicule de la force\", \"VL Target — véhicule adverse\" et \"Rassemblement\".",
                "terms": [
                  "Ajouter un point (membre ou pin OI)",
                  "Ajouter un point",
                  "Libellé personnalisé (appliqué aux pins génériques)",
                  "Membres PATRACDVR",
                  "Cyno",
                  "Rame VL — véhicule de la force",
                  "VL Target — véhicule adverse",
                  "Rassemblement"
                ],
                "selector": "#oi_carto_btn_ping",
                "tip": "Les membres viennent du PATRACDVR ; les « Rame VL » des véhicules du PATRACDVR et les « VL Target » du champ Véhicules des Adversaires."
              },
              {
                "title": "Placer, gerer et supprimer les pins",
                "body": "Dans chaque section, cliquez un membre/véhicule ou un bouton générique (« Cyno (générique) », « Rame VL (générique) », « VL Target (générique) », « Rassemblement ») : la modale se ferme et le bandeau « Cliquez sur la carte pour placer « {label} » » apparaît ; touchez la carte pour poser le pin. Un membre déjà posé est grisé avec « ✓ » ; le recliquer déplie « Réinitialiser » (retire le pin) et « Aller à » (centre dessus). En bas, « Supprimer tous les pins » efface tout après confirmation « Supprimer tous les pins de la carte ? », et « Annuler » ferme la modale.",
                "terms": [
                  "Cyno (générique)",
                  "Rame VL (générique)",
                  "VL Target (générique)",
                  "Rassemblement",
                  "Après sélection, cliquez sur la carte pour placer le point.",
                  "Cliquez sur la carte pour placer « {label} »",
                  "Réinitialiser",
                  "Aller à",
                  "Supprimer tous les pins",
                  "Supprimer tous les pins de la carte ?",
                  "Annuler"
                ],
                "selector": "#oi_carto_clear_pins",
                "tip": "Le bandeau d'indication porte « (clic ici pour annuler) » ; y cliquer, ou Échap, annule le placement en attente."
              },
              {
                "title": "Personnaliser un pin (roue radiale)",
                "body": "Un clic (sans glisser) sur un pin déjà posé ouvre une roue radiale : « Icône », « Couleur », « Renommer », « Centrer » et « Supprimer », le bouton central « FERMER » referme la roue. « Icône » ouvre « Choisir une icône », « Couleur » ouvre « Couleur du pin », « Renommer » ouvre « Renommer le point » (ou « Intitulé du membre » pour un membre). Vous pouvez aussi glisser un pin pour le repositionner : son libellé le suit.",
                "terms": [
                  "Icône",
                  "Couleur",
                  "Renommer",
                  "Centrer",
                  "Supprimer",
                  "FERMER",
                  "Choisir une icône",
                  "Couleur du pin",
                  "Renommer le point",
                  "Intitulé du membre"
                ],
                "selector": null,
                "tip": "La roue suit la carte quand vous la déplacez ; Échap, un clic extérieur ou « FERMER » la ferment."
              },
              {
                "title": "Dessiner et corriger les tracés",
                "body": "Le bouton \"Outils de dessin\" (icône draw) déplie un dock avec « Tracer un trait », « Tracer un rectangle » et « Tracer un cercle ». Choisissez une couleur (« Rouge », « Jaune », « Bleu », « Vert », « Blanc »), sélectionnez un outil (curseur en croix), puis glissez sur la carte pour tracer ; l'outil reste actif pour enchaîner. Cliquer un tracé existant propose de le supprimer via « Supprimer ce dessin ? ». Dans le dock, « Annuler (Ctrl+Z) » et « Rétablir (Ctrl+Y) » corrigent (aussi au clavier), et « Effacer tous les dessins » (balai, rouge) supprime tous les tracés après « Effacer tous les dessins ? ».",
                "terms": [
                  "Outils de dessin",
                  "Tracer un trait",
                  "Tracer un rectangle",
                  "Tracer un cercle",
                  "Rouge",
                  "Jaune",
                  "Bleu",
                  "Vert",
                  "Blanc",
                  "Supprimer ce dessin ?",
                  "Annuler (Ctrl+Z)",
                  "Rétablir (Ctrl+Y)",
                  "Effacer tous les dessins",
                  "Effacer tous les dessins ?"
                ],
                "selector": "#oi_carto_btn_draw",
                "tip": "Échap désactive l'outil de dessin actif sans fermer la carte."
              },
              {
                "title": "Affichage : libelles, relief 3D, plein ecran",
                "body": "Le bouton \"Afficher / masquer les libellés des pins\" bascule tous les libellés (contre la superposition), son icône passant de label à label_off. \"Basculer vue 2D / 3D relief\" active le relief (élévation + bâtiments extrudés) et incline la vue ; le recliquer revient à plat. \"Plein écran\" agrandit la carte à tout l'écran (icône fullscreen ↔ fullscreen_exit).",
                "terms": [
                  "Afficher / masquer les libellés des pins",
                  "Basculer vue 2D / 3D relief",
                  "Plein écran"
                ],
                "selector": "#oi_carto_btn_labels",
                "tip": "Si le relief est indisponible, un message « Relief 3D indisponible (réseau ?)... » s'affiche."
              },
              {
                "title": "Capturer la carte et fermer",
                "body": "Le bouton \"Capture de la carte (télécharger ou exporter vers un champ photo)\" ouvre la modale « Capture de la carte ». « Télécharger la capture (PNG) » enregistre l'image ; sinon choisissez une cible sous « Exporter la capture vers un champ photo de l'OI » puis « Exporter vers ce champ » pour l'injecter comme photo (toast « Capture de carte ajoutée au champ photo. »). « Fermer » referme la modale, et le bouton \"Fermer la cartographie\" (croix, en bas de la barre) ferme la carte.",
                "terms": [
                  "Capture de la carte (télécharger ou exporter vers un champ photo)",
                  "Capture de la carte",
                  "Télécharger la capture (PNG)",
                  "Exporter la capture vers un champ photo de l'OI",
                  "Exporter vers ce champ",
                  "Capture de carte ajoutée au champ photo.",
                  "Fermer",
                  "Fermer la cartographie"
                ],
                "selector": "#oi_carto_btn_capture",
                "tip": "L'export réutilise le pipeline photo de l'OI (compression standard) et cible les champs Transport, MOICP, ZMSPCP et Effraction."
              }
            ]
          },
          {
            "id": "annotation-photo",
            "icon": "draw",
            "title": "Annoter une photo tactique",
            "summary": "Outils de trace sur une photo : Bouger, Zone, Axe, Box, Texte, Membre, réglages, historique et validation.",
            "steps": [
              {
                "title": "Bouger : sélectionner, déplacer, pivoter, redimensionner",
                "body": "Dans la fenetre d'annotation, le bouton Bouger (icone pan_tool), actif par defaut dans la barre d'Outils, selectionne un objet d'un clic et le deplace par glissement (sur mobile il laisse aussi zoomer et deplacer la photo a deux doigts). Un clic — ou un appui long d'une demi-seconde au doigt — fait apparaitre un cadre pointille blanc avec une poignee ronde bleue en haut (rotation) et une poignee carree bleue en bas a droite (redimensionnement) : on glisse l'objet pour le deplacer, la poignee ronde pour pivoter, la poignee carree pour agrandir ou reduire uniformement.",
                "terms": [
                  "Bouger",
                  "Outils"
                ],
                "selector": "#tool_move",
                "tip": "L'appui long declenche une courte vibration pour confirmer la saisie tactile ; c'est aussi le seul outil qui deverrouille le zoom natif de la photo sur mobile."
              },
              {
                "title": "Zone : cercle de zone légendé",
                "body": "Le bouton Zone (icone pin_drop) trace un cercle translucide. A l'activation, l'invite Texte personnalisé de la zone : demande son libelle, puis on glisse depuis le centre vers l'exterieur pour fixer le rayon ; le remplissage utilise la couleur courante et l'Opacité reglee.",
                "terms": [
                  "Zone",
                  "Texte personnalisé de la zone :",
                  "Opacité"
                ],
                "selector": "#tool_location",
                "tip": "Un cercle de rayon inferieur a 5 px est ignore."
              },
              {
                "title": "Axe et Box : flèche et rectangle",
                "body": "Le bouton Axe (icone north_east) dessine une fleche : on glisse du point de depart au point d'arrivee, une pointe est ajoutee a l'extremite. Le bouton Box (icone crop_square) trace un rectangle en glissant pour definir deux coins opposes. Dans les deux cas le contour prend la couleur courante et l'epaisseur suit le reglage Trait.",
                "terms": [
                  "Axe",
                  "Box",
                  "Trait"
                ],
                "selector": "#tool_arrow",
                "tip": "Un trace ou un cote de moins de 5 px n'est pas cree."
              },
              {
                "title": "Texte : ajouter un libellé",
                "body": "Le bouton Texte (icone title) insere un texte libre : au clic sur la photo, l'invite Texte à insérer : s'ouvre et le texte saisi est pose au point clique, a la taille definie par le reglage Taille.",
                "terms": [
                  "Texte",
                  "Texte à insérer :",
                  "Taille"
                ],
                "selector": "#tool_text",
                "tip": "Laisser l'invite vide annule l'ajout."
              },
              {
                "title": "Membre : puce d'un équipier",
                "body": "Le bouton Membre (icone badge) ouvre la liste des equipiers du PATRACDVR ; cliquer un nom depose une puce arrondie affichant son trigramme au point choisi. Si aucun equipier n'est configure, le message Aucun membre configuré. s'affiche.",
                "terms": [
                  "Membre",
                  "Aucun membre configuré."
                ],
                "selector": "#tool_member",
                "tip": "Apres le depot, l'outil revient automatiquement sur Bouger."
              },
              {
                "title": "Styliser : réglages contextuels & couleur",
                "body": "Le panneau Réglages (a droite sur PC, en bas sur mobile) affiche des curseurs selon l'objet selectionne : Rotation (0 a 360 degres), Trait (epaisseur, pour Axe et Box), Taille (pour Texte et Membre) et Opacité (pour Zone). La rangee de pastilles en bas de la barre (rouge, vert, bleu, jaune, blanc) definit la couleur des nouveaux traces ; si un objet est deja selectionne, cliquer une pastille le recolore aussitot.",
                "terms": [
                  "Réglages",
                  "Rotation",
                  "Trait",
                  "Taille",
                  "Opacité"
                ],
                "selector": "#contextual_tools",
                "tip": "La couleur rouge est active par defaut ; chaque curseur ne s'affiche que pour le type d'objet concerne."
              },
              {
                "title": "Modifier le texte d'un objet",
                "body": "Le bouton Modifier le texte (icone edit_note) rouvre le libelle de l'objet selectionne via l'invite Modifier texte : ; il fonctionne pour une Zone, un Texte ou une puce Membre.",
                "terms": [
                  "Modifier le texte",
                  "Modifier texte :"
                ],
                "selector": "#edit_text_btn",
                "tip": "Le bouton reste sans effet si l'objet selectionne n'a pas de texte (Axe, Box)."
              },
              {
                "title": "Annuler, rétablir et supprimer",
                "body": "Les boutons Annuler (Ctrl+Z) et Rétablir (Ctrl+Y) (icones undo et redo) reviennent en arriere ou refont la derniere action, y compris au clavier tant que la fenetre est ouverte. Le bouton Supprimer l'objet (icone delete) efface uniquement l'objet selectionne, tandis que Réinitialiser tout (icone delete_sweep) efface l'ensemble des annotations de la photo.",
                "terms": [
                  "Annuler (Ctrl+Z)",
                  "Rétablir (Ctrl+Y)",
                  "Supprimer l'objet",
                  "Réinitialiser tout"
                ],
                "selector": "#annotation_undo",
                "tip": "Ctrl+Maj+Z equivaut aussi a Retablir ; Réinitialiser tout reste annulable via Annuler (Ctrl+Z)."
              },
              {
                "title": "Valider ou annuler l'annotation",
                "body": "En haut de la fenetre Annotation Photo, le bouton Valider applique et incruste les annotations sur la photo, tandis que le bouton Annuler referme la fenetre.",
                "terms": [
                  "Valider",
                  "Annuler",
                  "Annotation Photo"
                ],
                "selector": "#annotation_save_header",
                "tip": "Valider aplatit les traces dans l'image affichee ; a rouvrir l'annotation, ils restent editables tant que la session n'est pas fermee."
              }
            ]
          },
          {
            "id": "photos-presentation-export",
            "icon": "photo_camera",
            "title": "Photos, présentation & export PDF",
            "summary": "Importer et gérer les photos, personnaliser le fond, prévisualiser, présenter en plein écran et générer le PDF de l'OI.",
            "steps": [
              {
                "title": "Importer des photos",
                "body": "Dans chaque section photo, le bouton d'ajout ouvre le sélecteur de fichiers de l'appareil : sur une fiche adversaire (section « Photos & signalement ») via « Photo principale », « Photos supplémentaires » et « Photo(s) renforts » ; dans la partie « Cheminement » via « Transport PSIG → PR » et « Transport PR → Domicile/LE ». Chaque image est compressée puis stockée hors ligne et sa miniature apparaît aussitôt.",
                "terms": [
                  "Photos & signalement",
                  "Photo principale",
                  "Photos supplémentaires",
                  "Photo(s) renforts",
                  "Cheminement",
                  "Transport PSIG → PR",
                  "Transport PR → Domicile/LE",
                  "Échec d'enregistrement d'une photo (stockage saturé/indisponible). Exportez votre session puis réessayez."
                ],
                "selector": null,
                "tip": "« Photos supplémentaires » et « Photo(s) renforts » acceptent plusieurs fichiers ; « Photo principale » n'en conserve qu'une. En cas de stockage saturé, le message « Échec d'enregistrement d'une photo (stockage saturé/indisponible). Exportez votre session puis réessayez. » s'affiche."
              },
              {
                "title": "Légender, annoter et gérer une photo",
                "body": "Sous chaque miniature, le champ « Légende de la photo... » saisit le titre repris dans le PDF. Le bouton bleu (icône « edit ») ouvre l'éditeur d'annotation, le bouton doré (icône « hardware », uniquement sur les photos d'effraction) ouvre les outils d'effraction, et le bouton « × » supprime la photo. On réordonne les photos en les faisant glisser (glisser-déposer).",
                "terms": [
                  "Légende de la photo...",
                  "edit",
                  "hardware",
                  "×"
                ],
                "selector": null,
                "tip": "La légende et l'ordre sont enregistrés automatiquement ; les annotations dessinées sont fusionnées dans l'image au moment de la génération du PDF."
              },
              {
                "title": "Personnaliser le fond du PDF",
                "body": "À l'étape « 8. Finalisation & Conduites à tenir », le panneau « Fond PDF Personnalisé » remplace le fond par défaut (Grille Tactique). « 📂 Choisir Image » importe un JPEG/PNG (confirmation « Fond personnalisé enregistré. ») et « Rétablir Défaut » le retire (« Fond personnalisé supprimé. Le fond par défaut sera utilisé. »). L'aperçu du fond choisi s'affiche juste en dessous.",
                "terms": [
                  "Fond PDF Personnalisé",
                  "Vous pouvez remplacer le fond par défaut (Grille Tactique) par une image de votre choix.",
                  "📂 Choisir Image",
                  "Rétablir Défaut",
                  "Fond personnalisé enregistré.",
                  "Aucun fond personnalisé. Fond par défaut actif."
                ],
                "selector": "#custom_bg_preview_container",
                "tip": "Le fond personnalisé apparaît en filigrane sur la page de garde et sur la dernière page du PDF."
              },
              {
                "title": "Ouvrir l'aperçu (Mode Présentation)",
                "body": "En bas de l'étape Finalisation, « Aperçu (Mode Présentation) » ouvre la modale de présentation et génère un aperçu fidèle, page par page (« Génération de l'aperçu... »). Si des incohérences sont détectées, l'alerte « Attention: Des incohérences ont été détectées. Veuillez les vérifier dans la section Finalisation avant de générer. » s'affiche d'abord.",
                "terms": [
                  "Aperçu (Mode Présentation)",
                  "Génération de l'aperçu...",
                  "Attention: Des incohérences ont été détectées. Veuillez les vérifier dans la section Finalisation avant de générer."
                ],
                "selector": "#previewBtn",
                "tip": "L'aperçu et le PDF reprennent le thème sombre ou clair de l'application (bouton « Changer le thème » du dock)."
              },
              {
                "title": "Choisir le format d'export",
                "body": "Dans la barre d'actions de la modale de présentation, le sélecteur « Format PDF » bascule entre « A4 Paysage » (« 297×210 mm ») et « 16:9 » (« 338×190 mm »). Le choix est mémorisé et s'applique aussitôt à l'aperçu comme au PDF téléchargé.",
                "terms": [
                  "Format PDF",
                  "A4 Paysage",
                  "16:9",
                  "297×210 mm",
                  "338×190 mm"
                ],
                "selector": "#pdfFormatTrack",
                "tip": "Le format 16:9 réduit légèrement les marges pour maximiser le contenu affiché à l'écran ou au projecteur."
              },
              {
                "title": "Présenter ici (plein écran)",
                "body": "« Présenter ici » ouvre la présentation dans un nouvel onglet autonome plein écran (info-bulle « Ouvrir la présentation plein écran dans un nouvel onglet (téléphone, bureau, TV, projecteur) »). On navigue au clavier (← → Espace, Début, Fin) et au toucher (glissement) ; les boutons « ◀ Préc. », « Suiv. ▶ », « Mode liste » (bascule diapo/liste, touche L) et « ⛶ Plein écran » (touche F) pilotent l'affichage.",
                "terms": [
                  "Présenter ici",
                  "◀ Préc.",
                  "Suiv. ▶",
                  "Mode liste",
                  "⛶ Plein écran",
                  "Ouvrir la présentation plein écran dans un nouvel onglet (téléphone, bureau, TV, projecteur)"
                ],
                "selector": "#presentHereBtn",
                "tip": "Si rien ne s'ouvre, autorisez les pop-ups pour le site : le navigateur affiche « La fenêtre de présentation a été bloquée par le navigateur. »"
              },
              {
                "title": "Télécharger le PDF de l'OI",
                "body": "« Télécharger le PDF » lance la génération : la modale de chargement affiche l'avancement (« Collecte des données... », « Rendu : Page {i}/{N}... », « Assemblage final... ») sous « Veuillez patienter pendant la génération du rapport tactique. ». Le fichier est nommé OI_{date_op}_{trigramme_redacteur}.pdf et « PDF généré avec succès ! » confirme la réussite. Le bouton « Fermer » referme la modale.",
                "terms": [
                  "Télécharger le PDF",
                  "Veuillez patienter pendant la génération du rapport tactique.",
                  "Rendu : Page {i}/{N}...",
                  "Assemblage final...",
                  "PDF généré avec succès !",
                  "Fermer"
                ],
                "selector": "#downloadPdfBtn",
                "tip": "Sur un OI très riche en photos, si la mémoire manque : « PDF généré, mais {n} page(s) n'ont pas pu être rendues (mémoire insuffisante). Réduisez le nombre/poids des photos ou scindez l'OI. » — allégez alors les images."
              }
            ]
          }
        ]
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
