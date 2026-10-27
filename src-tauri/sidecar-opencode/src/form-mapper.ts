import type { FormAnswer, FormField, FormInfo, FormValue, QuestionAnswer, QuestionInfo, QuestionOption } from './types';

/** One question shown to the user, with the form field its answer belongs to. */
export interface QuestionBinding {
  field: FormField;
  question: QuestionInfo;
}

export interface MappedForm {
  bindings: QuestionBinding[];
  /** Why the form cannot be answered in the UI (the caller cancels it). */
  unsupported?: string;
}

const BOOLEAN_LABELS = { yes: 'Yes', no: 'No' } as const;

function toQuestion(field: FormField): QuestionInfo {
  let options: QuestionOption[] | undefined;
  if (field.type === 'boolean') {
    options = [{ label: BOOLEAN_LABELS.yes }, { label: BOOLEAN_LABELS.no }];
  } else if ((field.type === 'string' || field.type === 'multiselect') && field.options && field.options.length > 0) {
    options = field.options.map((option) =>
      option.description === undefined ? { label: option.label } : { label: option.label, description: option.description }
    );
  }

  // `question` tool forms carry the header in `title` and the question in `description`.
  const header = field.description !== undefined ? field.title : undefined;

  return {
    question: field.description ?? field.title ?? field.key,
    ...(header === undefined ? {} : { header }),
    ...(options === undefined ? {} : { options }),
    multiSelect: field.type === 'multiselect',
    custom: field.custom ?? true,
  };
}

/**
 * Turn a v2 form into UI questions. Hidden fields and fields with `when` conditions are skipped
 * (the `question` tool emits neither). An `external` field needs a flow the app cannot show, so
 * the whole form is reported as unsupported.
 */
export function mapFormToQuestions(form: FormInfo): MappedForm {
  const askable = form.fields.filter((field) => !(field.hidden || (field.when && field.when.length > 0)));

  const external = askable.find((field) => field.type === 'external');
  if (external) {
    return {
      bindings: [],
      unsupported: `Field "${external.key}" needs an external flow (${external.url ?? 'no url'}) that Cowork-Z cannot show`,
    };
  }

  if (askable.length === 0) {
    return { bindings: [], unsupported: 'The form has no answerable fields' };
  }

  return { bindings: askable.map((field) => ({ field, question: toQuestion(field) })) };
}

function optionValue(field: FormField, label: string): string {
  return field.options?.find((option) => option.label === label)?.value ?? label;
}

function toFormValue(field: FormField, answer: QuestionAnswer): FormValue | undefined {
  const labels = answer.labels ?? [];
  const typed = answer.customText?.trim() || undefined;

  switch (field.type) {
    case 'multiselect': {
      const values = labels.map((label) => optionValue(field, label));
      if (typed && field.custom !== false) values.push(typed);
      return values.length > 0 ? values : undefined;
    }
    case 'boolean': {
      const raw = typed ?? labels[0];
      if (raw === undefined) return undefined;
      if (/^(yes|true|y)$/i.test(raw)) return true;
      if (/^(no|false|n)$/i.test(raw)) return false;
      return raw;
    }
    case 'number':
    case 'integer': {
      const raw = typed ?? labels[0];
      if (raw === undefined) return undefined;
      const parsed = Number(raw);
      // Text that is not a number goes through as-is: the server rejects it and the user is asked again.
      return Number.isFinite(parsed) ? parsed : raw;
    }
    default: {
      if (typed) return typed;
      return labels[0] === undefined ? undefined : optionValue(field, labels[0]);
    }
  }
}

/** Build the `answer` object for a form reply. `answers[i]` belongs to `bindings[i]`; unanswered fields are left out. */
export function buildFormAnswer(bindings: QuestionBinding[], answers: QuestionAnswer[]): FormAnswer {
  const result: FormAnswer = {};
  for (const [index, binding] of bindings.entries()) {
    const answer = answers[index];
    if (!answer) continue;
    const value = toFormValue(binding.field, answer);
    if (value !== undefined) result[binding.field.key] = value;
  }
  return result;
}
