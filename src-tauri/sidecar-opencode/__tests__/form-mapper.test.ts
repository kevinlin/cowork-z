import { describe, expect, it } from '@jest/globals';
import { buildFormAnswer, mapFormToQuestions } from '../src/form-mapper';
import type { FormField, FormInfo } from '../src/types';

const form = (...fields: FormField[]): FormInfo => ({ id: 'frm_1', sessionID: 'ses_1', title: 'Questions', fields });

const colorOptions = [
  { value: 'red', label: 'Red', description: 'Choose red' },
  { value: 'blue', label: 'Blue' },
];

describe('mapFormToQuestions', () => {
  it('maps a string field with options to a single-select question, reading description as the question and title as the header', () => {
    const { bindings, unsupported } = mapFormToQuestions(
      form({
        key: 'q0',
        title: 'Color choice',
        description: 'Which color do you pick?',
        type: 'string',
        options: colorOptions,
        custom: true,
      })
    );

    expect(unsupported).toBeUndefined();
    expect(bindings.map((b) => b.question)).toEqual([
      {
        question: 'Which color do you pick?',
        header: 'Color choice',
        options: [{ label: 'Red', description: 'Choose red' }, { label: 'Blue' }],
        multiSelect: false,
        custom: true,
      },
    ]);
  });

  it('uses the title as the question when there is no description', () => {
    const { bindings } = mapFormToQuestions(form({ key: 'name', title: 'Your name', type: 'string' }));

    expect(bindings[0].question).toEqual({ question: 'Your name', multiSelect: false, custom: true });
  });

  it('falls back to the key when a field has neither title nor description', () => {
    const { bindings } = mapFormToQuestions(form({ key: 'q9', type: 'integer' }));

    expect(bindings[0].question.question).toBe('q9');
  });

  it('maps a string field without options to free text (no options)', () => {
    const { bindings } = mapFormToQuestions(form({ key: 'q0', description: 'Why?', type: 'string' }));

    expect(bindings[0].question.options).toBeUndefined();
    expect(bindings[0].question.multiSelect).toBe(false);
  });

  it('maps a multiselect field to multiSelect: true', () => {
    const { bindings } = mapFormToQuestions(
      form({ key: 'q0', description: 'Pick any', type: 'multiselect', options: colorOptions, custom: false })
    );

    expect(bindings[0].question).toEqual({
      question: 'Pick any',
      options: [{ label: 'Red', description: 'Choose red' }, { label: 'Blue' }],
      multiSelect: true,
      custom: false,
    });
  });

  it('carries custom: false through and defaults an absent custom flag to true', () => {
    const { bindings } = mapFormToQuestions(
      form(
        { key: 'a', type: 'string', options: colorOptions, custom: false },
        { key: 'b', type: 'string', options: colorOptions },
        { key: 'c', type: 'multiselect', options: colorOptions }
      )
    );

    expect(bindings.map((b) => b.question.custom)).toEqual([false, true, true]);
  });

  it('maps a boolean field to Yes/No options', () => {
    const { bindings } = mapFormToQuestions(form({ key: 'ok', description: 'Proceed?', type: 'boolean' }));

    expect(bindings[0].question.options).toEqual([{ label: 'Yes' }, { label: 'No' }]);
    expect(bindings[0].question.multiSelect).toBe(false);
  });

  it.each(['number', 'integer'] as const)('maps a %s field to free text', (type) => {
    const { bindings } = mapFormToQuestions(form({ key: 'n', description: 'How many?', type }));

    expect(bindings[0].question.options).toBeUndefined();
  });

  it('skips hidden fields and fields with a when condition', () => {
    const { bindings } = mapFormToQuestions(
      form(
        { key: 'visible', type: 'string' },
        { key: 'secret', type: 'string', hidden: true },
        { key: 'conditional', type: 'string', when: [{ key: 'visible', op: 'eq', value: 'x' }] }
      )
    );

    expect(bindings.map((b) => b.field.key)).toEqual(['visible']);
  });

  it('flags a form with an external field as unsupported', () => {
    const result = mapFormToQuestions(
      form({ key: 'q0', type: 'string' }, { key: 'auth', title: 'Sign in', type: 'external', url: 'https://example.test/auth' })
    );

    expect(result.unsupported).toMatch(/external/i);
    expect(result.unsupported).toContain('auth');
  });

  it('ignores an external field that is hidden', () => {
    const result = mapFormToQuestions(
      form({ key: 'q0', type: 'string' }, { key: 'auth', type: 'external', url: 'https://x.test', hidden: true })
    );

    expect(result.unsupported).toBeUndefined();
    expect(result.bindings).toHaveLength(1);
  });

  it('flags a form with nothing left to ask as unsupported', () => {
    expect(mapFormToQuestions(form({ key: 'h', type: 'string', hidden: true })).unsupported).toMatch(/no answerable fields/i);
  });
});

describe('buildFormAnswer', () => {
  const answerFor = (field: FormField, answer: { labels: string[]; customText?: string }) =>
    buildFormAnswer(mapFormToQuestions(form(field)).bindings, [answer]);

  it('single select: maps the chosen label back to the option value', () => {
    expect(answerFor({ key: 'q0', type: 'string', options: colorOptions, custom: true }, { labels: ['Red'] })).toEqual({ q0: 'red' });
  });

  it('single select: sends typed custom text as the value when custom answers are allowed', () => {
    expect(answerFor({ key: 'q0', type: 'string', options: colorOptions, custom: true }, { labels: [], customText: 'green' })).toEqual({
      q0: 'green',
    });
  });

  it('single select: passes an unknown label through unchanged', () => {
    expect(answerFor({ key: 'q0', type: 'string', options: colorOptions }, { labels: ['Mauve'] })).toEqual({ q0: 'Mauve' });
  });

  it('free text: sends the typed text', () => {
    expect(answerFor({ key: 'q0', type: 'string' }, { labels: [], customText: 'because' })).toEqual({ q0: 'because' });
  });

  it('multiselect: maps labels to values and appends the custom text when allowed', () => {
    const field: FormField = { key: 'q0', type: 'multiselect', options: colorOptions, custom: true };

    expect(answerFor(field, { labels: ['Red', 'Blue'] })).toEqual({ q0: ['red', 'blue'] });
    expect(answerFor(field, { labels: ['Red'], customText: 'green' })).toEqual({ q0: ['red', 'green'] });
  });

  it('multiselect: drops the custom text when custom answers are not allowed', () => {
    expect(
      answerFor({ key: 'q0', type: 'multiselect', options: colorOptions, custom: false }, { labels: ['Red'], customText: 'green' })
    ).toEqual({
      q0: ['red'],
    });
  });

  it('boolean: Yes and No become true and false', () => {
    expect(answerFor({ key: 'ok', type: 'boolean' }, { labels: ['Yes'] })).toEqual({ ok: true });
    expect(answerFor({ key: 'ok', type: 'boolean' }, { labels: ['No'] })).toEqual({ ok: false });
  });

  it('boolean: understands typed yes/no/true/false and passes anything else through for the server to reject', () => {
    expect(answerFor({ key: 'ok', type: 'boolean' }, { labels: [], customText: 'true' })).toEqual({ ok: true });
    expect(answerFor({ key: 'ok', type: 'boolean' }, { labels: [], customText: 'no' })).toEqual({ ok: false });
    expect(answerFor({ key: 'ok', type: 'boolean' }, { labels: [], customText: 'maybe' })).toEqual({ ok: 'maybe' });
  });

  it('number and integer: parse the typed text', () => {
    expect(answerFor({ key: 'n', type: 'number' }, { labels: [], customText: ' 3.5 ' })).toEqual({ n: 3.5 });
    expect(answerFor({ key: 'n', type: 'integer' }, { labels: [], customText: '42' })).toEqual({ n: 42 });
  });

  it('number: keeps text that is not a number so the server can reject it and the user is asked again', () => {
    expect(answerFor({ key: 'n', type: 'number' }, { labels: [], customText: 'lots' })).toEqual({ n: 'lots' });
  });

  it('omits fields that were left unanswered', () => {
    expect(answerFor({ key: 'q0', type: 'string' }, { labels: [] })).toEqual({});
    expect(answerFor({ key: 'q0', type: 'multiselect', options: colorOptions }, { labels: [] })).toEqual({});
  });

  it('answers each question by position and skips the fields that were not asked', () => {
    const { bindings } = mapFormToQuestions(
      form(
        { key: 'q0', type: 'string', options: colorOptions },
        { key: 'hidden', type: 'string', hidden: true },
        { key: 'q1', type: 'boolean' }
      )
    );

    expect(buildFormAnswer(bindings, [{ labels: ['Blue'] }, { labels: ['Yes'] }])).toEqual({ q0: 'blue', q1: true });
  });
});
