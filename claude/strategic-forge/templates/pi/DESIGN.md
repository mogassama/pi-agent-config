# Design Decisions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il porte les décisions propres à ce projet et leurs
> alternatives rejetées. La posture générale de l'agent (honnêteté épistémique,
> vérification des hypothèses, lisibilité, refus du scope creep) vit dans l'`AGENTS.md`
> global de pi, lu par l'orchestrateur seul, et n'est pas redéclarée ici.
>
> **Ce fichier porte le pourquoi, `CONVENTIONS.md` porte ce qui se juge.** Une décision
> se consulte quand une direction est en cause ; une règle avec sévérité se cite au
> `reviewer`. Le même énoncé ne vit jamais dans les deux fichiers.
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
> **Chaque décision est auto-portante.** Aucun sous-agent ne lit ce fichier :
> l'orchestrateur cite un extrait verbatim dans un texte de tâche, et l'enfant n'a rien
> d'autre. Nommer dans le corps de la décision les fichiers, répertoires et entités
> concernés ; aucun renvoi à une autre section, aucun pronom dont l'antécédent est
> ailleurs. Une décision dont le sens dépend de trois autres sections ne survit pas à la
> citation.
>
> **Ce fichier ne couvre que le structurant.** Les décisions d'implémentation prises à
> l'exécution parce que le bundle était muet ne remontent pas ici : elles sont notées
> dans le corps du commit. Elles n'ouvrent pas de retour vers Strategic Forge.

---

## Régressions — ce qu'une alternative rejetée interdit de réintroduire

> **Ce qui est ici, et ce qui n'y est pas.** Un anti-pattern figure dans ce fichier
> quand il est la **conséquence d'une alternative rejetée** : on a écarté X pour une
> raison documentée, donc réintroduire X est une régression, pas une découverte. C'est
> une justification à consulter.
>
> Ce qui se **juge** — une règle que le `reviewer` constate dans un diff — vit dans
> `CONVENTIONS.md` avec sa sévérité. Une entrée qui n'a pas d'alternative rejetée
> derrière elle n'a rien à faire ici.

| Ce qui ne se réintroduit pas | Décision qui l'a écarté | Ce qui tient à la place |
|---|---|---|
| [le pattern écarté] | [le titre de la décision ci-dessus, plus la raison en une ligne] | [ce qui a été retenu] |

La deuxième colonne porte la raison **en toutes lettres**, pas seulement le renvoi : qui
lit cette ligne citée seule doit comprendre pourquoi sans ouvrir le fichier.

Cette liste ne reprend ni les interdits universels portés par l'`AGENTS.md` global
(secrets en dur, destruction sans confirmation, dépendance injustifiée, code écrit
contre une API non vérifiée), ni les anti-patterns techniques portés par les skills, ni
ce qui est déjà bloqué par `bash-guard`, `pi-lint-gate` ou `pi-bq-cost-sentinel`.

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
