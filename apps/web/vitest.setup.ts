import { configure } from "@testing-library/react";

// Loaded CI runners render several times slower than a laptop, so async
// queries (findBy*, waitFor) get 5 s instead of 1 s (ticket 035).
configure({ asyncUtilTimeout: 5000 });
