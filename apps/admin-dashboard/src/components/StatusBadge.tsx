const MAP: Record<string, string> = {
  // order statuses
  COMPLETED:       'bg-emerald-100 text-emerald-700',
  PAID:            'bg-emerald-100 text-emerald-700',
  DELIVERED:       'bg-emerald-100 text-emerald-700',
  ACTIVE:          'bg-emerald-100 text-emerald-700',
  APPROVED:        'bg-emerald-100 text-emerald-700',
  SETTLED:         'bg-emerald-100 text-emerald-700',
  CONFIRMED:       'bg-blue-100 text-blue-700',
  SHIPPED:         'bg-blue-100 text-blue-700',
  IN_TRANSIT:      'bg-blue-100 text-blue-700',
  PAYMENT_PENDING: 'bg-yellow-100 text-yellow-700',
  PENDING:         'bg-yellow-100 text-yellow-700',
  PENDING_APPROVAL:'bg-yellow-100 text-yellow-700',
  PREPARING:       'bg-yellow-100 text-yellow-700',
  CANCELLED:            'bg-red-100 text-red-700',
  REJECTED:             'bg-red-100 text-red-700',
  FAILED:               'bg-red-100 text-red-700',
  RETURN_REQUESTED:     'bg-red-100 text-red-700',
  RETURNED:             'bg-red-100 text-red-700',
  REFUNDED:             'bg-purple-100 text-purple-700',
  INACTIVE:             'bg-slate-100 text-slate-600',
  DRAFT:                'bg-slate-100 text-slate-600',
  PAUSED:               'bg-slate-100 text-slate-600',
  REQUESTED:            'bg-yellow-100 text-yellow-700',
  ACCEPTED:             'bg-blue-100 text-blue-700',
  // roles
  'super-admin':   'bg-purple-100 text-purple-700',
  admin:           'bg-blue-100 text-blue-700',
  agent:           'bg-orange-100 text-orange-700',
  user:            'bg-slate-100 text-slate-600',
};

export default function StatusBadge({ value }: { value: string }) {
  const cls = MAP[value] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {value}
    </span>
  );
}
