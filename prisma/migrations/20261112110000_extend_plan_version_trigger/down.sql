-- Rollback for 20261112110000_extend_plan_version_trigger: back to the original 7 commercial columns.
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
    OLD."validityUnit" IS DISTINCT FROM NEW."validityUnit"
  ) THEN
    NEW."version" = OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
