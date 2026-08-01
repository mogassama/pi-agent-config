# Design Decisions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il porte les décisions propres à ce projet et leurs
> alternatives rejetées. La posture générale de l'agent (honnêteté épistémique,
> vérification des hypothèses, lisibilité, refus du scope creep) vit dans l'`AGENTS.md`
> global de pi et n'est pas redéclarée ici.
>
> **Règle de production.** Les blocs de l'annexe ne sont recopiés que si l'outil
> correspondant a été validé en session. L'annexe n'apparaît jamais dans le livrable.

---

## Contraintes subies

> Section présente uniquement si la stack a été déclarée contrainte en Phase 0.
> Elle existe pour que pi ne rouvre pas des débats déjà tranchés hors du projet.

| Contrainte | Origine | Conséquence acceptée |
|---|---|---|
| [outil / service / version imposé] | [existant \| employeur \| client \| coût \| compétences] | [ce qu'on renonce à faire] |

Ces lignes ne sont **pas** rediscutables par pi. Un risque identifié est documenté
ici en une ligne, puis on passe à autre chose.

---

## [Titre de la décision]

**Problème :** [le besoin réel, pas la solution déguisée en problème]
**Décision :** [ce qui a été retenu, formulé de façon actionnable]
**Alternatives rejetées :** [option + raison du rejet, une ligne chacune]
**Statut :** `To implement` | `Implemented` | `Roadmap`

> Une section par décision structurante issue du débat. Une décision présentée sans
> alternative rejetée signale que le débat n'a pas eu lieu — la rouvrir en session, pas
> à l'exécution. Le statut est mis à jour par pi au fil de l'implémentation — c'est le
> seul champ du bundle qu'il peut modifier.
>
> **Chaque décision est auto-portante.** `oracle` et `oracle-deep` tournent en
> `inheritProjectContext: false` : ils ne liront jamais ce fichier, seulement l'extrait
> qu'on leur passe. Une décision dont le sens dépend de trois autres sections ne
> survivra pas à une escalade.
>
> **Ce fichier ne couvre que le structurant.** Les décisions d'implémentation prises à
> l'exécution parce que le bundle était muet ne remontent pas ici : elles sont notées
> dans le corps du commit. Elles n'ouvrent pas de retour vers Strategic Forge.

---

## Anti-patterns interdits dans ce projet

[Liste issue du débat de Phase 2. Chaque entrée nomme le pattern, la raison, et le
comportement attendu à la place.]

| Pattern | Raison | À la place |
|---|---|---|
| [ce que pi ne doit jamais faire] | [pourquoi, en une ligne] | [le comportement correct] |

Cette liste ne reprend ni les interdits universels déjà portés par `AGENTS.md`
(secrets en dur, destruction sans confirmation, dépendance injustifiée, code écrit
contre une API non vérifiée), ni les anti-patterns techniques portés par les skills,
ni ce qui est déjà bloqué par `bash-guard` ou `pi-bq-cost-sentinel`. Elle ne contient
que le spécifique au projet.

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

> **Ne jamais recopier cette annexe dans le livrable.** Chaque bloc est intégré comme
> section à part entière du `DESIGN.md` produit si, et seulement si, la stack retenue
> le justifie.

<details>
<summary>Coût d'exécution comme contrainte de premier ordre — facturation à l'usage</summary>

Toute opération est évaluée sous l'angle du coût avant d'être écrite.
- Privilégier les accès filtrés par partition ou index plutôt que les scans complets.
- Une opération qui traite un volume disproportionné au résultat produit est presque
  toujours un problème de design, pas un problème de quota.
- Signaler explicitement tout coût unitaire qui dépasse l'ordre de grandeur attendu.
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
