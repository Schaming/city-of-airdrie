import type { TextFieldSingleValidation } from 'payload';
import {
  BoldFeature,
  defaultColors,
  ItalicFeature,
  LinkFeature,
  ParagraphFeature,
  TextStateFeature,
  lexicalEditor,
  UnderlineFeature,
  type LinkFields,
} from '@payloadcms/richtext-lexical';
import { StyledListFeature } from '@/lexical/features/StyledListFeature/server';

export const defaultLexical = lexicalEditor({
  features: ({ defaultFeatures }) => {
    // Remove the built-in LinkFeature so we can re-add our customized one
    const featuresWithoutDefaultLink = defaultFeatures.filter(feature => feature.key !== 'link');

    return [
      ...featuresWithoutDefaultLink,

      // You *can* still add explicit Paragraph/Bold/Italic/Underline
      // if you want, but usually defaultFeatures already include them.
      ParagraphFeature(),
      UnderlineFeature(),
      BoldFeature(),
      ItalicFeature(),

      // Text and background colors (toolbar dropdown)
      TextStateFeature({
        state: {
          color: {
            ...defaultColors.text,
            ...defaultColors.background,
          },
        },
      }),

      // Styled ordered lists (decimal / upper-roman / lower-roman) in rich text
      StyledListFeature(),

      // Our custom LinkFeature with extra fields
      LinkFeature({
        enabledCollections: ['pages', 'posts'],
        fields: ({ defaultFields }) => {
          const defaultFieldsWithoutUrl = defaultFields.filter(field => {
            if ('name' in field && field.name === 'url') return false;
            return true;
          });

          return [
            ...defaultFieldsWithoutUrl,
            {
              name: 'url',
              type: 'text',
              admin: {
                condition: (_data, siblingData) => siblingData?.linkType !== 'internal',
              },
              label: ({ t }) => t('fields:enterURL'),
              required: true,
              validate: ((value, options) => {
                if ((options?.siblingData as LinkFields)?.linkType === 'internal') {
                  return true;
                }
                return value ? true : 'URL is required';
              }) as TextFieldSingleValidation,
            },
            {
              name: 'actionKey',
              type: 'text',
              required: false,
              admin: {
                description: 'Optional action key, e.g. "scrollToSubsection", "openOverlay".',
              },
            },
            {
              name: 'actionPayload',
              type: 'text',
              required: false,
              admin: {
                description: 'Optional payload for the action, e.g. "subsection-b.2.1".',
              },
            },
          ];
        },
      }),
    ];
  },
});
