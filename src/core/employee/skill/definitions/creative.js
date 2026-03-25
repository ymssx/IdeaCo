/**
 * Creative Skills — Built-in skill definitions for content creation.
 */

import { SkillCategory } from '../constants.js';

export const creativeSkills = [
  {
    id: 'content-writing',
    name: 'Content Writing',
    category: SkillCategory.CREATIVE,
    description: 'Write articles, blog posts, documentation, and marketing copy',
    body: `# Content Writing Skill

## Workflow
1. Understand the audience and purpose
2. Research the topic thoroughly
3. Create an outline with clear structure
4. Write compelling content with proper formatting
5. Edit for clarity, grammar, and tone consistency

## Best Practices
- Lead with value — hook the reader in the first paragraph
- Use clear headings and subheadings for scanability
- Write in active voice
- Keep paragraphs short (3-5 sentences)
- End with a clear call-to-action or conclusion`,
    requiredTools: ['file_write'],
    tags: ['writing', 'blog', 'documentation', 'copywriting'],
    icon: '✍️',
  },

  {
    id: 'image-generation',
    name: 'Image Generation',
    category: SkillCategory.CREATIVE,
    description: 'Generate images using AI from text descriptions',
    body: `# Image Generation Skill

## Workflow
1. Understand the visual concept needed
2. Write a detailed, descriptive prompt
3. Specify style, mood, composition, and technical parameters
4. Generate and iterate on results
5. Deliver final images with appropriate naming

## Best Practices
- Be specific about composition, lighting, and style
- Include negative prompts to avoid unwanted elements
- Specify aspect ratio and resolution
- Iterate with variations for best results`,
    requiredPlugins: ['builtin-image'],
    tags: ['image', 'art', 'visual', 'generation'],
    icon: '🎨',
  },
];
