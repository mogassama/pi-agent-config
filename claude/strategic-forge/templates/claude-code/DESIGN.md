# Design Decisions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il porte les décisions propres à ce projet et leurs
> alternatives rejetées. La posture générale de l'agent — honnêteté épistémique,
> vérification des hypothèses, lisibilité, refus du scope creep — vit dans
> `~/.claude/CLAUDE.md` et n'est pas redéclarée ici.
>
> **Régime de lecture.** Lu à la demande, jamais chargé automatiquement. Sa fonction
> principale est d'empêcher la réouverture d'une décision qui paraît arbitraire hors
> de son contexte.
>
> **Règle de production.** Les blocs de l'annexe ne sont recopiés que si l'outil
> correspondant a été validé en session. L'annexe n'apparaît jamais dans le livrable.

---

## Contraintes subies

> Section présente uniquement si la stack a été déclarée contrainte en Phase 0 — ce
> qui est le cas courant sur cette cible.

| Contrainte | Origine | Conséquence acceptée |
|---|---|---|
| [outil / service / version imposé] | [existant \| employeur \| client \| coût \| compétences] | [ce qu'on renonce à faire] |

Ces lignes ne sont **pas** rediscutables. Un risque identifié est documenté ici en une
ligne, puis on passe à autre chose.

---

## [Titre de la décision]

**Problème :** [le besoin réel, pas la solution déguisée en problème]
**Décision :** [ce qui a été retenu, formulé de façon actionnable]
**Alternatives rejetées :** [option + raison du rejet, une ligne chacune]
**Statut :** `To implement` | `Implemented` | `Roadmap`

> Une section par décision structurante issue du débat. Une décision présentée sans
> alternative rejetée signale que le débat n'a pas eu lieu — la rouvrir en session, pas
> à l'exécution. Le statut se met à jour au fil de l'implémentation : c'est l'un des
> deux seuls champs du bundle modifiables en session.
>
> **Ce fichier ne couvre que le structurant.** Les décisions d'implémentation prises à
> l'exécution parce que le bundle était muet ne remontent pas ici : elles sont notées
> dans le corps du commit. Elles n'ouvrent pas de retour vers Strategic Forge.
>
> **Chaque décision est auto-portante.** Elle se comprend sans lire les autres
> sections du fichier — un subagent en contexte isolé n'aura que l'extrait.

---

## Anti-patterns interdits dans ce projet

| Pattern | Raison | À la place |
|---|---|---|
| [ce qu'il ne faut jamais faire ici] | [pourquoi, en une ligne] | [le comportement correct] |

Cette liste ne reprend **ni** les interdits universels de `~/.claude/CLAUDE.md`
(secrets en dur, suppression sans dry-run, modification de fichier critique sans diff,
dépendance lourde injustifiée, fonctionnalité non demandée, code contre une API non
vérifiée), **ni** les anti-patterns techniques de `~/.claude/rules/conventions.md`.
Elle ne contient que le spécifique au projet.

Si cette section est vide après filtrage, la supprimer. Une section vide invite au
remplissage.

---

## Sécurité

> Section présente uniquement si `+SECURITY` a été activé en Phase 0.

**Surface d'attaque identifiée :** [ce qui est exposé, et à qui]
**Modèle de permissions :** [identités, portée minimale de chaque identité]
**Gestion des credentials :** [où ils vivent, comment ils sont injectés, rotation]
**Données sensibles :** [nature, localisation, traitement — ou « aucune », explicitement]
**Recommandations rejetées :** [ce qui a été écarté et pourquoi]

---
---

# ANNEXE — blocs de référence conditionnels

> **Ne jamais recopier cette annexe dans le livrable.** Chaque bloc devient une section
> à part entière du `DESIGN.md` produit si, et seulement si, la stack retenue le
> justifie **et** que le point n'est pas déjà couvert par le socle global.

<details>
<summary>Coût d'exécution comme contrainte de premier ordre — facturation à l'usage</summary>

Toute opération est évaluée sous l'angle du coût avant d'être écrite.
- Privilégier les accès filtrés par partition ou index plutôt que les scans complets.
- Une opération qui traite un volume disproportionné au résultat produit est presque
  toujours un problème de design, pas un problème de quota.
- Signaler explicitement tout coût unitaire qui dépasse l'ordre de grandeur attendu.

*Vérifier avant inclusion :* un gate de coût BigQuery existe déjà en hook. Ce bloc n'a
d'intérêt que si le projet consomme une autre ressource facturée à l'usage.
</details>

<details>
<summary>Données = état mutable, code = état immuable</summary>

Le code se redéploie, les données ne se dé-écrivent pas.
- Toute opération destructive est annoncée avant exécution.
- Préférer « écrire dans une cible temporaire puis basculer » à la mutation en place.
- Préférer l'écriture incrémentale par clé au rechargement complet ad hoc.
</details>

<details>
<summary>Schémas comme contrats</summary>

Un changement de schéma est un changement d'API.
- Vérifier les consommateurs downstream avant tout ajout, retrait ou renommage.
- Préférer « ajouter puis déprécier » à « renommer ».
- Documenter le changement dans la PR, pas seulement dans le code.
</details>
