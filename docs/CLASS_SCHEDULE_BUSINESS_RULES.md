# Class & Schedule — Business Rules

Source of product intent for classes, weekly recurrence, session instances, and coach assignment.  
Use this doc instead of retyping flows in chat.

**Status vs backend (branch with classes/schedule, e.g. `fix/updatemembershipplan`):**

| Flow | Status |
| --- | --- |
| Admin creates class template | Implemented |
| Weekly recurring slots (same day + time) | Implemented (`ClassSlot`) |
| Generate / create session instances for a day | Implemented (job + one-off create) |
| Edit instance fields; rest stay defaults | Partially implemented (`overriddenFields` / `overrideDetails`) |
| Change class defaults → update future non-customized sessions only | Implemented (propagation; skips past, cancelled, and field-overridden sessions) |
| Multiple coaches on a class | Implemented (`ClassCoach`; also slot/session coach joins) |
| Assign coaches by checking availability | **Not implemented** (stubs always “available / qualified”) |
| Coach weekly availability hours | **Not implemented** (no model) |
| Coach unavailability (off / vacation / emergency) | **Not implemented** (`isCoachOnLeave` stub always `false`) |
| Remove coach from a class/session; assign replacement | Partially: coaches can be edited on class/slot/session APIs, but **no leave-driven auto-remove** and **no availability gate** |

---

## 1. Concepts (glossary)

| Term | Meaning |
| --- | --- |
| **Class (template)** | The reusable definition: name, duration, capacity, type, intensity, visibility, default coaches, eligible plans. |
| **Slot (recurrence rule)** | Weekly pattern under a class: day of week + start/end time (+ optional capacity/coach override). Repeats every week. |
| **Session (instance)** | One concrete occurrence on a calendar day/time. Created from a slot (generated) or as a one-off. |
| **Default values** | Values inherited from class (and slot where set): duration, capacity, coaches, etc. |
| **Customized / overridden** | Fields explicitly changed on that session only. Tracked so class updates do **not** overwrite them. |
| **Availability** | Recurring weekly windows when a coach *can* work. |
| **Unavailability** | Time ranges when a coach *cannot* work (vacation, sick, emergency off). Wins over availability. |

Hierarchy:

```
Class (template)
  └── ClassSlot (weekly recurrence)
        └── ClassSession (instance for a specific datetime)
```

One-off sessions may exist with `slotId = null` (still linked to a class).

---

## 2. Class template (admin)

### 2.1 Create / update
- Admin (or Owner) creates and updates classes.
- A class may have **multiple coaches** as defaults.
- Public classes must have **at least one eligible membership plan**.
- Classes are not hard-deleted. Lifecycle: `ACTIVE` ↔ `DEACTIVATED` → `ARCHIVED`.
- Deactivate / archive must be blocked when future sessions already have bookings (when bookings exist).

### 2.2 Changing class defaults (propagation)
When admin changes class default values (e.g. `baseCapacity`, `durationMin`, default coaches):

1. Update the **class template**.
2. Propagate to **future** sessions that still inherit that field (not customized).
3. **Do not** change:
   - Past sessions
   - Cancelled sessions
   - Sessions where that field is in `overriddenFields`
4. Customized fields on an instance stay as the admin/coach set them for that day only.

> Rule of thumb: *class edit updates defaults on instances; it never silently wipes a per-day customization.*

---

## 3. Recurring slots

### 3.1 Behaviour
- Admin defines slots: ISO day of week + wall-clock start/end in the facility timezone (default `Asia/Dubai`).
- Slot repeats every week from `startDate` while `active = true`.
- Slot may override capacity and/or coaches for that weekly pattern; otherwise inherit from class.
- Deleting/deactivating a slot soft-deactivates it and should prune **future unbooked** generated sessions (booked sessions stay until handled by booking rules).

### 3.2 Generation
- A scheduler/job materializes upcoming `ClassSession` rows from active slots.
- Generated sessions snapshot defaults at creation (`capacity`, times, coaches, etc.).
- Unique constraint: one session per `(classId, startAt)`.

---

## 4. Session instances (particular day)

### 4.1 Create instance
- From slot (generated), or admin creates a **one-off** session for a specific datetime.
- Unspecified fields take class/slot defaults.

### 4.2 Edit instance (customization)
Allowed overrides (recommended set):

| Field | Notes |
| --- | --- |
| `capacity` | Day-specific headcount |
| `duration` / `endAt` | Day-specific length |
| `coaches` | Day-specific coach list |
| `startAt` | Move that occurrence only (careful with conflicts) |
| cancel / restore | Operational controls |

When a field is overridden:
- Mark it in `overriddenFields` (and details as needed).
- Later class/slot default changes **must not** overwrite that field on this session.

### 4.3 Cancel / restore
- Cancel marks the instance cancelled with reason; does not delete history.
- Restore only if policy allows (capacity/coach still valid, no conflicting booking rules).

---

## 5. Coaches on classes (your core flows)

### 5.1 Multiple coaches
- A class can have **many** coaches (default roster).
- A slot can narrow/override coaches for that weekly time.
- A session can further override coaches for that day.

### 5.2 Assign by availability (REQUIRED — not built yet)
Before attaching a coach to a class, slot, or session, the system must:

1. Coach status is `ACTIVE`.
2. Coach is **qualified** for that class (when qualification matrix exists).
3. For every occurrence time window being covered:
   - Coach is inside an **availability** window, **and**
   - Coach is **not** inside an **unavailability** (leave/vacation/emergency), **and**
   - Coach is not already double-booked on another session (optional hardening).
4. If any check fails → reject assignment with a clear error (which coach, which conflict).

### 5.3 Availability hours (REQUIRED — not built yet)
- Each coach has one or more weekly availability ranges (e.g. Mon–Fri 06:00–14:00).
- Assignments outside availability are rejected unless an explicit admin override flag is used (product decision: allow override? default **no**).

### 5.4 Unavailability / leave (REQUIRED — not built yet)
Types (recommended): `VACATION`, `SICK`, `EMERGENCY`, `OTHER`.

Rules:
- Unavailability is a time range (`startAt`–`endAt`) on a coach.
- Unavailability **beats** availability.
- While on leave, coach must not be newly assigned to overlapping sessions.

### 5.5 Emergency off after already assigned (REQUIRED — not built yet)
Flow you described:

1. Coach is assigned to a class/slot/session.
2. Coach takes emergency leave covering that time.
3. System (or admin action driven by leave create):
   - Removes (or flags) the coach from **affected future sessions**.
   - Does **not** silently invent a replacement.
4. Admin assigns another coach to those sessions/class, subject to availability checks (5.2).
5. Audit: who was removed, why (leave id/reason), who was added.

Recommended product choices to lock later:
- Auto-remove from **sessions only** vs also strip from class default roster.
- Notify admin/members (out of scope until notifications ticket).
- If session would have **zero coaches** after removal → block leave save **or** allow leave but mark session `NEEDS_COACH` (prefer explicit status/flag).

---

## 6. Role permissions (recommended)

| Action | OWNER | ADMIN | COACH | MEMBER |
| --- | --- | --- | --- | --- |
| CRUD class / slots | ✓ | ✓ | — | — |
| Set eligible plans | ✓ | ✓ | — | — |
| Create/patch/cancel sessions | ✓ | ✓ | cancel own? (TBD) | — |
| Manage coach availability/leave | ✓ | ✓ | manage **own** leave request (TBD) | — |
| View schedule | ✓ | ✓ | ✓ | ✓ (public classes only) |

Current API already gives ADMIN full class/slot write and strong session controls; availability/leave APIs do not exist yet.

---

## 7. What to build next (gap backlog)

Ordered for your described flows:

1. **CoachAvailability** model + CRUD (weekly hours).
2. **CoachUnavailability / Leave** model + CRUD (vacation/emergency ranges).
3. Wire `isCoachOnLeave` / `isCoachQualified` adapters to real data (replace stubs).
4. Enforce availability + leave + conflict checks on:
   - class coach assign
   - slot coach assign
   - session coach assign / patch
5. Leave-create side effect: detach coach from overlapping future sessions; surface sessions needing a replacement.
6. Admin “reassign coach” action (session or bulk by date range) with the same checks.
7. Optional: `NEEDS_COACH` session flag + admin list filter.

---

## 8. Non-goals (for now)

- Member booking / waitlist / credits consumption (stubs exist; separate tickets).
- Payroll / coach rates.
- Automatic replacement coach suggestion (nice-to-have after availability exists).

---

## 9. Short answer to “is my functionality working?”

**Partially.**

- Recurring weekly classes → slots → day instances: **yes**.
- Instance customization vs class default propagation: **yes (core idea)**.
- Multiple coaches on a class: **yes**.
- Assign coaches by checking availability slots: **no**.
- Coach availability hours + vacation/emergency unavailability: **no**.
- Emergency remove + later admin adds another coach as a governed leave flow: **no** (manual coach edits possible; leave-aware automation and checks are missing).

When implementing, treat **§5** as the contract for coach assignment behaviour.
