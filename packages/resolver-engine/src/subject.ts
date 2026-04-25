import type { CompositeSubject, SingleSubject, Subject } from "@ffp/shared-types";

/**
 * Iterate over the typed sub-subjects in a Subject. A SingleSubject yields
 * itself once; a CompositeSubject yields one entry per sub-subject with its
 * type re-attached.
 */
export function* iterSubjects(subject: Subject): Generator<SingleSubject> {
  if (subject.type === "composite") {
    const composite = subject as CompositeSubject;
    for (const [type, attrs] of Object.entries(composite.subjects)) {
      yield { type, ...attrs } as SingleSubject;
    }
    return;
  }
  yield subject as SingleSubject;
}

/** Get the sub-subject of a given type, if present. */
export function subjectOfType(subject: Subject, type: string): SingleSubject | null {
  for (const s of iterSubjects(subject)) {
    if (s.type === type) return s;
  }
  return null;
}
