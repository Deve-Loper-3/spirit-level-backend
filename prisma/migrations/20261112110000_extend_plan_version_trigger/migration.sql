-- The commercial version of a plan now also changes when its term, recurrence, period or joining
-- fee changes. membershipId, name, description and the other non-commercial columns still do not.
CREATE OR REPLACE FUNCTION bump_membership_plan_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    OLD."price" IS DISTINCT FROM NEW."price" OR
    OLD."billingCycle" IS DISTINCT FROM NEW."billingCycle" OR
    OLD."creditType" IS DISTINCT FROM NEW."creditType" OR
    OLD."creditsIncluded" IS DISTINCT FROM NEW."creditsIncluded" OR
    OLD."creditRefill" IS DISTINCT FROM NEW."creditRefill" OR
    OLD."validityValue" IS DISTINCT FROM NEW."validityValue" OR
    OLD."validityUnit" IS DISTINCT FROM NEW."validityUnit" OR
    OLD."term" IS DISTINCT FROM NEW."term" OR
    OLD."recurring" IS DISTINCT FROM NEW."recurring" OR
    OLD."periodMonths" IS DISTINCT FROM NEW."periodMonths" OR
    OLD."joiningFee" IS DISTINCT FROM NEW."joiningFee"
  ) THEN
    NEW."version" = OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
