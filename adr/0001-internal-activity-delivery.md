# Optimize Internal Activity Delivery by Avoiding Network Requests

## Status

Approved

## Context

Our multitenant ActivityPub service currently sends all activities over the network, including to internal accounts on the same service. This creates significant performance and operational issues:

**Current Behavior:**
- When account A (on our service) creates a post and account B (also on our service) follows A, we send the Create activity to B's inbox via HTTP
- This results in unnecessary network requests to ourselves for internal follower relationships
- The same data processing (feed updates, notifications) already happens in the domain layer when the Post is created and saved

**Problems This Causes:**
1. **Self-DDoS**: Accounts with large followings generate hundreds of HTTP requests to our own service
2. **NAT Port Exhaustion**: High volume of outbound connections exhausts available NAT ports
3. **Unnecessary Latency**: Network round trips for data we already have locally
4. **Resource Waste**: CPU, memory, and network bandwidth spent on redundant operations
5. **Scaling Bottleneck**: Performance degrades as our user base and internal connections grow

**Risk Assessment:**
- Create activities: Low risk - domain layer already handles feed/notification updates
- Other activities (Follow, Accept, etc.): Medium risk - requires investigation to ensure no side effects

## Decision

We will implement a phased approach to optimize internal activity delivery:

**Phase 1: Create Activities**
- Stop sending Create activities over the network when both sender and recipient are internal accounts
- Rely on existing domain layer logic for feed updates and notifications
- Implement detection logic to identify internal vs external recipients

**Phase 2: Other Activity Types**
- Investigate Follow, Accept, and other activity types to determine safety of internal optimization
- Extend the optimization to additional activity types where safe

**Implementation Strategy:**
- Add internal account check in activity delivery logic
- Filter internal recipients from network delivery queues
- Maintain existing behavior for external recipients
- Add comprehensive logging and monitoring to track the change

## Consequences

**Positive:**
- **Performance**: Eliminates hundreds of unnecessary HTTP requests for popular accounts
- **Reliability**: Reduces NAT port exhaustion and self-DDoS scenarios  
- **Scalability**: Internal growth no longer creates quadratic network overhead
- **Resource Efficiency**: Lower CPU, memory, and bandwidth usage
- **Cost Reduction**: Fewer compute resources needed for redundant operations

**Negative:**
- **Code Complexity**: Adds branching logic between internal and external delivery paths
- **Testing Overhead**: Need to test both internal and external delivery scenarios
- **Debugging**: Network logs will no longer show internal activity flow
- **Risk**: Potential for subtle bugs if domain layer doesn't fully replicate network delivery side effects

**Mitigation Strategies:**
  - **Risk**
    - Start with low-risk Create activities only
    - Test in production behind a single-account gate
    - Automated testing of internal delivery scenarios
    - Environment variable flag to revert if issues arise
    - Comprehensive logging to show flow of all deliveries
    - Thorough investigation of other activity types before Phase 2
