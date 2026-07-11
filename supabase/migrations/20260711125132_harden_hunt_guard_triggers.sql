-- Trigger guards must inspect private hunt state when Data API users write.
alter function private.protect_active_hunt_membership() security definer;
alter function private.protect_active_hunt_game() security definer;
