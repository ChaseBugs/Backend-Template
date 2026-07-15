package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.List;

/** Mirrors GET /api/admin/dashboard response. Nested arrays are raw pg rows (snake_case keys). */
public class DashboardSummary implements Serializable {
    public int totalUsers;
    public double totalRevenue;
    public List<StatusCount> ordersByStatus;
    public List<AgentStatusCount> agentsByStatus;

    public int agentCountByStatus(String approvalStatus) {
        if (agentsByStatus == null) return 0;
        for (AgentStatusCount row : agentsByStatus) {
            if (approvalStatus.equals(row.approval_status)) {
                try {
                    return Integer.parseInt(row.count);
                } catch (NumberFormatException e) {
                    return 0;
                }
            }
        }
        return 0;
    }

    public int totalAgents() {
        if (agentsByStatus == null) return 0;
        int total = 0;
        for (AgentStatusCount row : agentsByStatus) {
            try {
                total += Integer.parseInt(row.count);
            } catch (NumberFormatException ignored) {
                // skip malformed row
            }
        }
        return total;
    }
}
