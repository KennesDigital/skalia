'use strict';

const FIELD_TYPES = [
  { value: 'text',        label: 'Text (einzeilig)',    badge: 'Aa',  color: '#0038D6' },
  { value: 'textarea',    label: 'Text (mehrzeilig)',   badge: '¶',   color: '#0038D6' },
  { value: 'number',      label: 'Zahl',                badge: '#',   color: '#7C3AED' },
  { value: 'currency',    label: 'Währung',             badge: '€',   color: '#7C3AED' },
  { value: 'date',        label: 'Datum',               badge: 'D',   color: '#059669' },
  { value: 'datetime',    label: 'Datum & Uhrzeit',     badge: 'DT',  color: '#059669' },
  { value: 'time',        label: 'Uhrzeit',             badge: 'T',   color: '#059669' },
  { value: 'boolean',     label: 'Ja/Nein',             badge: '✓',  color: '#16A34A' },
  { value: 'choice',      label: 'Auswahl',             badge: '◉',  color: '#D97706' },
  { value: 'multichoice', label: 'Mehrfachauswahl',     badge: '≡',  color: '#D97706' },
  { value: 'reference',   label: 'Verknüpfung',         badge: '↗',  color: '#DC2626' },
  { value: 'formula',     label: 'Formel',              badge: 'fx',  color: '#6B7280' },
  { value: 'url',         label: 'URL',                 badge: 'URL', color: '#0891B2' },
  { value: 'email',       label: 'E-Mail',              badge: '@',   color: '#0891B2' },
  { value: 'phone',       label: 'Telefon',             badge: '☎',  color: '#0891B2' },
  { value: 'file',        label: 'Datei',               badge: '📎', color: '#9333EA' },
  { value: 'image',       label: 'Bild',                badge: 'IMG', color: '#9333EA' },
  { value: 'signature',   label: 'Unterschrift',        badge: '✍',  color: '#9333EA' },
  { value: 'qr',          label: 'QR-Code',             badge: 'QR',  color: '#374151' },
  { value: 'color',       label: 'Farbe',               badge: '◈',  color: '#EA580C' },
  { value: 'button',      label: 'Schaltfläche',        badge: 'BTN', color: '#374151' },
  { value: 'content',     label: 'Inhalt (statisch)',   badge: '‖',   color: '#374151' },
];

const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map(t => [t.value, t]));

// Types that get shown in ER diagram as fields
const SIMPLE_TYPES = new Set(['text','textarea','number','currency','date','datetime',
  'time','boolean','url','email','phone','color','content']);

// Time estimates in hours
const TIME = {
  setup: 1.0,
  perTable: 0.5,
  field: {
    text: .2, textarea: .2, number: .2, currency: .25, date: .2, datetime: .2,
    time: .2, boolean: .15, choice: .4, multichoice: .5, reference: .75,
    formula: 1.0, url: .15, email: .15, phone: .15, file: .3, image: .3,
    signature: .3, qr: .3, color: .15, button: .75, content: .1,
  },
  trigger: .75,
  condition: .25,
  buffer: 1.25,
};

const TABLE_COLORS = [
  '#0038D6','#7C3AED','#DC2626','#D97706','#059669',
  '#0891B2','#DB2777','#65A30D','#9333EA','#EA580C',
];

// Types where the "Standardwert" input should be hidden
const HIDE_DEFAULT = new Set(['reference','formula','button','content','file','image','signature','qr']);
// Types where formula/script textarea shows
const SHOW_FORMULA = new Set(['formula','button']);
// Types where choices list shows
const SHOW_CHOICES = new Set(['choice','multichoice']);
