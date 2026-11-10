# Business Rules — Memberships, Plans and Client Entitlements

**Project:** Spirit Level Gym  
**Section:** Business Rules → Memberships & Subscriptions  
**Reference:** Staff prototype and documentation updated October 23, 2026, with later approved client requirements.

**Backend status (summary):** Plan/membership **catalog** is partially implemented (create/list/get/update/status + Glofox seed on feature branches). **Client purchase, subscription, credits ledger, discounts, reports, and booking entitlement checks** are largely **not** implemented yet. See [§ Implementation status](#implementation-status-vs-backend) at the end.

---

## BR-MEM-01: Membership Definition

A membership is a logical container used to group related purchasable plans.

Each membership has a unique name, description and associated plans.

A membership does not independently provide service access, credits or a payment obligation.

## BR-MEM-02: Plan Definition

A plan is the actual purchasable product.

A plan defines its price, billing configuration, credits or applicable access benefits, and validity/renewal conditions.

A plan can belong to a membership or exist independently.

Standalone products such as First Class must remain supported.

## BR-MEM-03: Membership Creation

Authorized staff can create a new membership and associate plans with it.

The staff interface must allow:
1. Plan in an existing membership.
2. New membership with name and description, followed by plan creation.

Duplicate membership names are not permitted.

Creating a membership does not automatically enroll any clients.

## BR-MEM-04: Subscription and Purchase

A client receives access only after a valid plan purchase or authorized assignment.

The system must associate the purchased plan with the client, including applicable dates, payment information and entitlement.

A client's subscription is independent of the shared plan definition.

Changing a plan definition must not retroactively rewrite historical client purchases.

## BR-MEM-05: Billing Types

Plans may be configured for a single purchase or recurring card billing.

Supported recurring periods are:
- Monthly: +1 month.
- Quarterly: +3 months.
- Half-yearly: +6 months.
- Yearly: +12 months.

The plan's configured billing period determines its default next renewal date.

A single-purchase plan must not be treated as an automatically renewing subscription.

## BR-MEM-06: Subscription Dates

A subscription has a start date and, where applicable, a next renewal date.

Staff may override the default renewal or end date.

A subscription end date is optional, controlled by the Has End Date switch.

Renewal and end dates must be later than the start date.

The subscription's validity must be considered when determining current service access.

## BR-MEM-07: Changing an Existing Plan

When staff edit a client's existing plan without selecting a different plan, only subscription dates may be changed.

No payment is charged.

The Save action is disabled until a date is modified.

## BR-MEM-08: Changing to a Different Plan

The approved staff workflow is:

1. Select new subscription dates.
2. Select the new plan.
3. Confirm the start date and payment.
4. Optionally apply a valid promo code.
5. Calculate the amount due.
6. Complete and persist the change.

The new plan's configured benefits determine the resulting entitlement.

Unused credit transfer, proration and overlapping subscription treatment are not specified in the current documentation and must not be assumed.

## BR-MEM-09: Class Membership Eligibility

A client can book a class using a membership plan only if:
- The client's plan is valid for the booking.
- The selected class accepts the plan.
- The client has sufficient applicable credits, where credits are required.
- The booking complies with the class booking rules.

A membership name alone does not establish class eligibility.

## BR-MEM-10: Class Credits

Credits must be allocated according to the purchased plan.

Each class must consume the credit amount defined by the approved business configuration.

The system must not assume that all classes consume the same number of credits.

A confirmed booking deducts the applicable credits.

Cancelled bookings must follow the approved cancellation and credit-return rules.

The same booking must not deduct credits more than once.

## BR-MEM-11: Credit Packs

Credit Packs are separate from Class Memberships.

A credit pack provides a defined number of credits for a configured validity period.

A pack does not automatically create a recurring membership subscription.

Its credits can be consumed only for eligible services/classes.

The system must track the remaining balance and applicable expiry independently.

## BR-MEM-12: Online Coaching

Online Coaching is a separate service category with its own purchasable plans.

Online Coaching provides access to the coaching programme specified by the selected plan.

It does not automatically provide access to physical gym classes, facilities or appointments.

The staff prototype provides a flat Online Coaching plan list.

Online Coaching client-management screens are excluded from the approved scope.

## BR-MEM-13: Appointments

Appointments remain a separate booking category.

Appointment availability is determined by the trainer's availability, existing classes, appointments and applicable buffers.

Appointment booking and cancellation rules must be applied independently from class bookings.

A class membership or credit pack does not automatically entitle a client to an appointment unless explicitly configured in the approved product benefits.

## BR-MEM-14: Facilities

Facilities remain a separate service category.

Facility eligibility and booking rules must be determined from the approved facility/product configuration.

The configured facility cancellation rule is one hour.

Do not automatically grant access to all facilities merely because a client has an active class membership.

Facility definitions and their final access rules remain subject to completion/confirmation.

## BR-MEM-15: Discounts

Discounts are managed under Services → Discounts.

A promo code must:
- Exist.
- Be active.
- Be valid on the plan start date.
- Apply to the selected membership/plan.

Code comparison is case-insensitive.

Discounts apply to the first charge according to the approved rules.

The Teachers discount requires manual staff verification of the teacher ID.

## BR-MEM-16: Client Profile and Visibility

Client records must display the client's applicable membership/plan information.

The Clients module uses searchable membership-plan multi-select filters, consistent with Reports.

Membership chips must reflect the client's associated memberships.

The Add Client button remains excluded from the approved staff prototype.

## BR-MEM-17: Reporting

Membership-related reports must use actual client subscription and payment data.

The existing report categories include:
- Active members.
- New sign-ups.
- Expiring memberships.
- Lost memberships.
- Retention.
- Lead conversion.

Recurring reporting must use the same billing period as the corresponding plan.

## BR-MEM-18: Booking Rule Integration

Membership and credit eligibility must be evaluated alongside existing booking rules.

Approved class booking defaults include:
- Booking opens 21 days before class.
- Booking closes 1 hour before class.
- Free cancellation up to 12 hours before class.
- Two no-shows trigger blocking.
- Waitlist maximum of four.
- Refunded credit validity of 90 days.
- Overbooking according to configured rules.

Staff cannot bypass booking rules through an override or add guests through the removed staff booking controls.

These are booking-level rules, not benefits automatically attached to every membership.

## BR-MEM-19: Product Separation

The system must maintain five distinct service categories:

1. Class Memberships — grouped class plans and subscriptions.
2. Credit Packs — one-time credit-based products.
3. Online Coaching — coaching products and programme access.
4. Appointments — bookable trainer services.
5. Facilities — bookable or accessible gym facilities.

Shared infrastructure may be used for payments, members and entitlement checks.

Product-specific eligibility, credit consumption and booking logic must remain separate.

## BR-MEM-20: Outstanding Business Decisions

The following must be resolved before finalizing product seed data and access rules:

- Glofox lists 17 memberships while the supplied business sheet lists 16; Hyrox Build Coached is missing from the sheet.
- Peak Coached appears with duplicate naming.
- Monthly Open Gym is recurring in the prototype but desk-payment-only in the business sheet.
- Exact class eligibility and credit consumption must be confirmed from the latest approved business data.
- Subscription payment execution, failed renewals, proration and credit transfers require confirmed business behavior before implementation.

Until resolved, the system must not invent or infer these rules.

---

## Implementation status vs backend

Snapshot against current Spirit Level backend (catalog work on plan/membership feature branches; client entitlement domain mostly absent).

| Rule | Status | Notes |
| --- | --- | --- |
| BR-MEM-01 | Partial | `Membership` container exists on feature branch; unique name; no access by itself |
| BR-MEM-02 | Partial | `MembershipPlan` catalog with price/billing/credits/validity; optional `membershipId`; standalone supported |
| BR-MEM-03 | Partial | Create membership + create plan with existing/new membership modes; no client enrollment on create |
| BR-MEM-04 | **Missing** | No client purchase / assignment / subscription entitlement model |
| BR-MEM-05 | Partial (catalog only) | Billing cycles on plan; no live recurring card billing / renewal engine |
| BR-MEM-06–08 | **Missing** | No client subscription dates / change-plan staff workflows / payments |
| BR-MEM-09 | Partial | Class↔plan eligibility exists on classes branch; client-side “valid purchase + credits” not built |
| BR-MEM-10 | **Missing** | No credits ledger / per-class credit cost / booking deduction |
| BR-MEM-11 | Partial (catalog) | `CREDIT_PACK` kind + validity fields; no purchased pack balance/expiry tracking |
| BR-MEM-12 | Partial (catalog) | Online coaching section derived from `creditType = TIME`; no coaching programme access engine |
| BR-MEM-13 | **Missing** | Appointments domain not implemented |
| BR-MEM-14 | **Missing** | Facilities domain not implemented |
| BR-MEM-15 | **Missing** | Discounts / promo codes not implemented |
| BR-MEM-16 | **Missing** (API) | No client membership chips / subscription on profile APIs |
| BR-MEM-17 | **Missing** | No membership reports from subscription/payment data |
| BR-MEM-18 | **Missing** | Booking window / no-show / waitlist rules not implemented as booking engine |
| BR-MEM-19 | Intent only | Catalog kinds/sections hint at separation; appointments/facilities not built |
| BR-MEM-20 | Open | Do not invent seed/payment/proration/credit-transfer behaviour |

**Hard rule for engineers:** where BR-MEM-20 says undecided, do not invent behaviour in code or seeds.

Related docs:
- [`CLASS_SCHEDULE_BUSINESS_RULES.md`](./CLASS_SCHEDULE_BUSINESS_RULES.md) — class recurrence, sessions, coach availability
