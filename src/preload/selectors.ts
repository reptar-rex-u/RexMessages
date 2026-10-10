// Every Google Messages DOM selector lives here. When Google changes their
// markup, this is the only file that should need editing. Each entry is a
// list tried in order; the first selector that matches wins.
//
// Find new ones with View > Toggle Developer Tools in the main window.

export interface Selectors {
  conversationPath: string
  authPath: string
  rememberDeviceSwitch: string[]
  conversationListItem: string[]
  conversationItemName: string[]
  conversationItemLink: string[]
  unreadConversation: string[]
  headerName: string[]
  composeInput: string[]
  sendButton: string[]
  messageScroller: string[]
  messageList: string[]
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
  messageImage: [
    'mws-messages-list mws-image-message-part img',
    'mws-messages-list mws-message-part-content img',
    'mws-messages-list img'
  ],
  imageExcludeAncestors: ['mws-avatar', 'mws-contact-avatar', '[data-e2e-avatar]', 'mws-reactions', '.avatar']
}
