export interface FulfillmentStatusRow {
  status: string;
  count: number;
}

export interface FulfillmentSummary {
  byStatus: Record<string, number>;
  toShip: number;
  inTransit: number;
  delivered: number;
  returnRequested: number;
  actionNeeded: number;
}

const IN_TRANSIT_STATUSES = ['SHIPPED', 'IN_TRANSIT'];

export function buildFulfillmentSummary(rows: FulfillmentStatusRow[]): FulfillmentSummary {
  const summary: FulfillmentSummary = {
    byStatus: {},
    toShip: 0,
    inTransit: 0,
    delivered: 0,
    returnRequested: 0,
    actionNeeded: 0,
  };

  for (const row of rows) {
    summary.byStatus[row.status] = row.count;
    if (row.status === 'PREPARING') summary.toShip += row.count;
    else if (IN_TRANSIT_STATUSES.includes(row.status)) summary.inTransit += row.count;
    else if (row.status === 'DELIVERED') summary.delivered += row.count;
    else if (row.status === 'RETURN_REQUESTED') summary.returnRequested += row.count;
  }

  // Groups the seller must act on right now: ship, handle a return, or fix a failure.
  summary.actionNeeded = summary.toShip + summary.returnRequested + (summary.byStatus.FAILED ?? 0);
  return summary;
}
