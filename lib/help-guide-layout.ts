export type HelpSectionId =
  | 'necessity'
  | 'handling-guide'
  | 'file-routing'
  | 'support-scope'
  | 'tool-purpose'
  | 'steps'
  | 'document-rules'
  | 'review-cautions';

export type HelpTabId = 'understanding' | 'usage';

export type HelpTab = {
  id: HelpTabId;
  label: string;
  sectionIds: readonly HelpSectionId[];
};

export const HELP_TABS: readonly HelpTab[] = [
  {
    id: 'understanding',
    label: '전처리 이해하기',
    sectionIds: ['necessity', 'handling-guide'],
  },
  {
    id: 'usage',
    label: '사용 방법',
    sectionIds: [
      'tool-purpose',
      'steps',
      'file-routing',
      'support-scope',
      'document-rules',
      'review-cautions',
    ],
  },
];

export function getHelpTab(id: HelpTabId): HelpTab {
  const tab = HELP_TABS.find((item) => item.id === id);
  if (!tab) throw new Error(`Unknown help tab: ${id}`);
  return tab;
}
