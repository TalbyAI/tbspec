import type { Dependency } from "./schemas.ts";

export interface OntologyCandidate {
  selector: string;
  graphIri: string;
  signature: string;
  rank: number;
  dependencyId?: string;
}

export interface OntologyResolution {
  state: "none" | "resolved" | "broken-choice" | "ambiguous-choice" | "tie";
  signature?: string;
  chosenDependencyId?: string;
  effective: OntologyCandidate[];
  conflicted: OntologyCandidate[];
}

export function dependencyDistances(
  dependency: Dependency,
  initialDistance = 0,
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [];
  const add = (key: string, distance: number) => {
    if (distance >= (distances.get(key) ?? Infinity)) return;
    distances.set(key, distance);
    queue.push(key);
  };
  add(dependency.primary, initialDistance);
  for (const attachment of dependency.attachments)
    if (attachment.active) add(String(attachment.primary), initialDistance);
  while (queue.length) {
    const key = queue.shift();
    if (!key) continue;
    const context = dependency.files.find((file) => file.key === key)?.context;
    const next = (target: unknown) =>
      add(String(target), (distances.get(key) ?? initialDistance) + 1);
    for (const edge of dependency.edges)
      if (edge.from === key && edge.context === context && edge.to) next(edge.to);
    for (const binding of dependency.bindings)
      if (binding.resource === key && binding.context === context)
        for (const target of [
          ...((binding.ontologies as string[] | undefined) ?? []),
          ...((binding.schemas as string[] | undefined) ?? []),
        ])
          next(target);
    for (const association of dependency.associations)
      if (association.resource === key && association.context === context && association.active)
        next(association.support);
  }
  return distances;
}

export function resolveOntologyCandidates(
  graphIri: string,
  candidates: OntologyCandidate[],
  choices: Record<string, string> = {},
): OntologyResolution {
  const matching = candidates.filter((candidate) => candidate.graphIri === graphIri);
  if (!matching.length)
    return {
      state: Object.hasOwn(choices, graphIri) ? "broken-choice" : "none",
      ...(Object.hasOwn(choices, graphIri) ? { chosenDependencyId: choices[graphIri] } : {}),
      effective: [],
      conflicted: [],
    };
  const chosenDependencyId = Object.hasOwn(choices, graphIri) ? choices[graphIri] : undefined;
  if (chosenDependencyId !== undefined) {
    const chosen = matching.filter((candidate) => candidate.dependencyId === chosenDependencyId);
    if (!chosen.length)
      return {
        state: "broken-choice",
        chosenDependencyId,
        effective: [],
        conflicted: [],
      };
    if (new Set(chosen.map((candidate) => candidate.signature)).size > 1)
      return {
        state: "ambiguous-choice",
        chosenDependencyId,
        effective: [],
        conflicted: chosen,
      };
    const signature = chosen[0]?.signature;
    return {
      state: "resolved",
      ...(signature ? { signature } : {}),
      chosenDependencyId,
      effective: matching.filter((candidate) => candidate.signature === signature),
      conflicted: [],
    };
  }

  const ranks = new Map<string, number>();
  for (const candidate of matching)
    ranks.set(
      candidate.signature,
      Math.min(ranks.get(candidate.signature) ?? Infinity, candidate.rank),
    );
  const rank = Math.min(...ranks.values());
  const winningSignatures = [...ranks]
    .filter(([, candidateRank]) => candidateRank === rank)
    .map(([signature]) => signature);
  if (winningSignatures.length > 1)
    return {
      state: "tie",
      effective: [],
      conflicted: matching.filter((candidate) => winningSignatures.includes(candidate.signature)),
    };
  const signature = winningSignatures[0];
  return {
    state: "resolved",
    ...(signature ? { signature } : {}),
    effective: matching.filter((candidate) => candidate.signature === signature),
    conflicted: [],
  };
}
