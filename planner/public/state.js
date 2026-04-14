'use strict';

const state = {
  projects: [],          // summary list
  current: null,         // full current project object
  modal: {
    type: null,          // 'project'|'table'|'field'|'confirm'
    editId: null,        // id being edited (null = create)
    tableId: null,       // for field modal: which table
    confirmCb: null,     // callback for confirm modal
  },
  choices: [],           // temp choices while field modal is open
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' }).format(new Date(iso));
  } catch { return ''; }
}
