# Receiving History Employee Reference Assessment

No general received-by or entered-by employee field was physically proven in
the retained `POT-04` or `POT-14` layouts.

The three-character `POT-04` member at header positions 109–111 is a message
code, not an employee identifier. `POT-03` contains a rejection-event operator
code; that value applies only to the rejection event and must not be promoted
to a general received-by identity.

The canonical baseline therefore leaves received-by employee unavailable and
does not resolve a name from a current employee master.
