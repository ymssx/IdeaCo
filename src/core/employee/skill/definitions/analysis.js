/**
 * Analysis Skills — Built-in skill definitions for data analysis and research.
 */

import { SkillCategory } from '../constants.js';

export const analysisSkills = [
  {
    id: 'data-analysis',
    name: 'Data Analysis',
    category: SkillCategory.ANALYSIS,
    description: 'Analyze datasets, find patterns, generate insights and reports',
    body: `# Data Analysis Skill

## Workflow
1. Load and inspect the dataset — understand columns, types, distributions
2. Clean data: handle missing values, remove duplicates, fix types
3. Perform exploratory analysis: statistics, correlations, outliers
4. Generate visualizations to support findings
5. Synthesize insights into a clear, actionable report

## Best Practices
- Always start with data profiling before analysis
- Handle missing data explicitly (drop, impute, flag)
- Use appropriate statistical tests for your data type
- Present findings with clear visualizations
- Distinguish correlation from causation`,
    requiredTools: ['file_read'],
    requiredPlugins: ['builtin-data-processing'],
    tags: ['analytics', 'statistics', 'insights', 'reports'],
    icon: '📊',
  },

  {
    id: 'web-research',
    name: 'Web Research',
    category: SkillCategory.RESEARCH,
    description: 'Search the web, gather information, and synthesize findings',
    body: `# Web Research Skill

## Workflow
1. Understand the research question — define scope and key terms
2. Search multiple sources for diverse perspectives
3. Cross-reference findings for accuracy
4. Synthesize information into structured findings
5. Cite sources and note confidence levels

## Best Practices
- Use multiple search queries with different phrasings
- Prioritize authoritative and recent sources
- Note when information conflicts across sources
- Distinguish facts from opinions
- Provide source URLs for all key claims`,
    requiredTools: [],
    requiredPlugins: ['builtin-web-search', 'builtin-web-fetch'],
    tags: ['research', 'web', 'search', 'information-gathering'],
    icon: '🔍',
  },
];
