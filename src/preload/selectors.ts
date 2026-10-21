// Every Google Messages DOM selector lives here. When Google changes their
// markup, this is the only file that should need editing. Each entry is a
// list tried in order; the first selector that matches wins.
//
// Find new ones with View > Toggle Developer Tools in the main window.

export interface Selectors {
  conversationPath: string
  authPath: string
  rememberDeviceSwitch: string[]
  conversationList: string[]
  conversationListItem: string[]
  conversationItemName: string[]
  conversationItemLink: string[]
  unreadConversation: string[]
  headerName: string[]
  composeInput: string[]
  sendButton: string[]
  messageScroller: string[]
  messageList: string[]
  messageWrapper: string[]
  messagePart: string[]
  messageTextFallback: string[]
  messageTimestamp: string[]
  messageDateChip: string[]
  /** Attribute names tried in order. Not CSS. Unstable Angular ids are rejected later. */
  messageIdAttr: string[]
  messageMenuButton: string[]
  messageMenu: string[]
  messageMenuItem: string[]
  confirmDialog: string[]
  confirmButton: string[]
  messageImage: string[]
  imageExcludeAncestors: string[]
}

export const SELECTORS: Selectors = {
  conversationPath: '/conversations/',

  // QR pairing page and its "Remember this computer" switch.
  authPath: '/web/authentication',
  rememberDeviceSwitch: [
    'mat-slide-toggle.local-storage-checkbox button[role="switch"]',
    '.local-storage-checkbox [role="switch"]'
  ],

  conversationList: ['mws-conversations-list', 'mws-conversation-list', '[data-e2e-conversation-list]'],
  conversationListItem: ['mws-conversation-list-item', '[data-e2e-conversation]'],
  conversationItemName: ['[data-e2e-conversation-name]', '.name', 'h2', 'h3'],
  conversationItemLink: ['a[href*="/conversations/"]', 'a'],
  unreadConversation: [
    'mws-conversation-list-item a[data-e2e-is-unread="true"]',
    'mws-conversation-list-item .unread',
    'mws-conversation-list-item [data-e2e-is-unread="true"]'
  ],

  headerName: [
    'mw-conversation-header mws-header h2',
    'mw-conversation-header h2',
    'mws-conversation-header [data-e2e-conversation-name]',
    'mws-conversation-header h2',
    'mws-conversation-header .title',
    '[data-e2e-conversation-header] [data-e2e-conversation-name]'
  ],

  // Google keeps a hidden textarea next to the visible contenteditable box, and
  // a hidden duplicate send button; inject.ts only uses visible matches.
  composeInput: [
    '[contenteditable="true"][data-e2e-message-input-box]',
    'textarea[data-e2e-message-input-box]',
    'mws-message-compose textarea',
    'mws-autosize-textarea textarea',
    'textarea.input',
    'mws-message-compose [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
  ],
  sendButton: [
    'button[data-e2e-send-text-button]',
    'mws-message-send-button button',
    'mws-message-compose button[aria-label^="Send" i]'
  ],

  messageScroller: ['mws-bottom-anchored', 'mws-messages-list .content', 'mws-messages-list'],
  messageList: ['mws-messages-list', '[data-e2e-message-list]'],
  // .text-msg sits inside mws-text-message-part. Keep them separate so one bubble
  // is not counted twice. The menu button is the bubble's own More control, not
  // the conversation row's "Options for …" menu.
  messageWrapper: ['mws-message-wrapper', '[data-e2e-message-wrapper]'],
  messagePart: ['mws-text-message-part', '[data-e2e-message-text]'],
  messageTextFallback: ['.text-msg', 'mws-message-part-content'],
  messageTimestamp: ['mws-relative-timestamp', '[data-e2e-message-timestamp]', 'time[datetime]'],
  messageDateChip: ['mws-tombstone-message', '[data-e2e-tombstone]', 'mws-message-list-separator'],
  messageIdAttr: ['data-message-id', 'msg-id', 'data-msg-id'],
  messageMenuButton: [
    'button[data-e2e-message-more]',
    'button[aria-label="More" i]',
    'button[aria-label="More options" i]',
    'button[aria-label*="message options" i]',
    'button[aria-label*="Message actions" i]'
  ],
  messageMenu: ['[role="menu"]', '.mat-mdc-menu-panel'],
  messageMenuItem: ['[role="menuitem"]', '.mat-mdc-menu-item'],
  confirmDialog: ['[role="alertdialog"]', '[role="dialog"]', 'mat-dialog-container'],
  confirmButton: ['button', '[role="button"]'],
  messageImage: [
    'mws-messages-list mws-image-message-part img',
    'mws-messages-list mws-message-part-content img',
    'mws-messages-list img'
  ],
  imageExcludeAncestors: ['mws-avatar', 'mws-contact-avatar', '[data-e2e-avatar]', 'mws-reactions', '.avatar']
}
