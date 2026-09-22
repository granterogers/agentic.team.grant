# Project home v2 — Grant's specification, 22 September 2026

**Verbatim. Do not condense, summarise or reorder.** CLAUDE.md records what a
tidied paraphrase of a requirements document cost this project once already: a
day of frontend work built against a reconstruction, roughly half of it
specifically wrong.

Grant's own framing of this message:

> Yes. I'll preserve the earlier non-chat requirements, replace the previous
> chat requirements with your new clarified chat specification, and add
> everything from this message. I'm deliberately keeping individual
> requirements separate rather than collapsing them.

So: the earlier §21 requirements stand except where a line below replaces
them, and the chat requirements below REPLACE the previous ones.

---

* Terminology
   * Miniature = the compact version of a module shown on the project homepage/dashboard.
   * Expanded = the full version of that module.
   * Use these terms consistently throughout the implementation and documentation.
* Team member pictures / avatars
   * Do not display pictures or avatars of team members throughout the project homepage.
   * They should not appear unnecessarily in modules, cards, headers, project areas, etc.
   * Team imagery belongs only where it is actually relevant to interaction with the team.
* Chat is NOT a project-home module
   * Remove the Chat to the Team module from the project homepage.
   * Do not replace it with another chat module.
   * It is completely superfluous when the sidebar already provides this functionality.
* Chat sidebar
   * Retain the existing sidebar approach for communicating with the team.
   * This becomes the primary typed team-chat interface.
   * The sidebar should contain the actual team conversation/history and normal messaging functionality.
* Remove "Ask the Team"
   * Remove Ask the Team from the top of the interface.
   * It duplicates the team communication functionality.
* Rename "Talk to the Team"
   * Change the existing Talk to the Team button to simply Chat.
   * The blue Chat button opens the team-chat sidebar.
* Dedicated voice button
   * Place a microphone icon immediately next to the blue Chat button.
   * This is a separate control from Chat.
   * Clicking the microphone should immediately activate the OpenAI voice interface / pure voice mode.
   * Its purpose is simply to begin a dynamic natural spoken conversation.
   * Do not introduce an unnecessary intermediate screen or another custom chat interface when the microphone is clicked.
* Remove "Change this page"
   * Remove the existing Change this page control/text.
   * Replace it with a conventional three-dot (`…`) menu.
   * This should become the cleaner access point for appropriate page-level controls/settings.
* Remove the existing up/down module arrangement
   * Remove the current up/down controls for repositioning modules.
   * Do not use buttons/arrows that move modules one position at a time.
   * This interaction is not wanted.
* Freeform module movement
   * Modules should be directly draggable around the project homepage.
   * The user should be able to dynamically rearrange components spatially.
   * Movement should feel direct rather than being mediated through up/down controls.
* Resizable modules
   * Modules should be dynamically resizable.
   * For example, Documents & Files could be enlarged when the user wants more room for documents.
   * Different modules can therefore occupy different amounts of dashboard space according to need.
   * Define sensible minimum dimensions for each module.
   * Define sensible maximum dimensions.
   * Resizing should not break module contents or controls.
   * Modules must not overlap one another.
   * Surrounding modules/layout should respond intelligently when one is moved or resized.
   * The overall system should behave like a polished responsive dashboard/grid rather than freely positioned overlapping windows.
* Miniatures must be functional
   * Miniatures are not merely previews of information.
   * Controls and items displayed inside them should be usable directly wherever practical.
   * The user should not constantly be forced to open an expanded view to perform simple actions.
   * Clicking appropriate elements inside miniatures should perform the corresponding action.
* Expanded module behaviour
   * When a module needs its expanded view, it should open as a pop-up/modal overlay, rather than navigating away to a completely separate page.
   * The expanded interface should have an appropriately positioned X for closing it.
   * Closing it should return naturally to the underlying project homepage.
* Module borders
   * The current borders around modules/elements are too thin.
   * Increase their visual weight.
   * Borders should contribute to the polished, premium appearance rather than looking like faint wireframes.
* Module hover treatment
   * Hovering over a module should produce an attractive visual response.
   * Introduce something such as a subtle blue glow around the module.
   * The effect should clearly indicate interactivity without becoming garish.
* Gradients / visual depth
   * Improve the overall visual treatment using tasteful gradient effects.
   * Gradients should work with the different colour schemes.
   * Modules/cards should have more visual depth and presence.
   * The interface should "pop" more rather than looking flat.
   * Maintain a coherent premium design rather than adding effects indiscriminately.
* To-dos — miniature
   * To-dos must actually work.
   * Each to-do should have a functional checkbox.
   * Clicking the checkbox in the miniature immediately marks the task as complete.
   * The user should not need to open the expanded view simply to complete a task.
* To-dos — expanded
   * Opening To-dos should show the expanded version as a modal/pop-up.
   * Tasks remain directly interactive.
   * Each task has a functional checkbox.
   * Tasks can be marked complete from the expanded interface.
* To-dos + Vecunia
   * The To-dos system is intended to interface with Vecunia.
   * Architect the To-do implementation accordingly from the outset.
   * Do not build a disconnected visual mock-up that subsequently needs to be rebuilt for Vecunia integration.
* Schedule — miniature
   * Schedule must actually work in miniature form.
   * Existing schedule entries should be clickable.
   * Clicking Schedule or its contents should actually perform an action rather than doing nothing.
* Schedule — expanded
   * Schedule should have a functional expanded/modal view.
   * Existing events should be openable.
   * The user should be able to add new events.
   * Event creation should include dates, times and event details.
   * It should be a functional scheduling interface rather than a static visual representation.
* Contacts — miniature
   * Contacts should be interactive directly from the miniature.
   * Clicking a contact should show useful information/details.
   * Contact information should be accessible from the miniature without unnecessarily forcing navigation elsewhere.
   * The user should be able to add a new contact directly from the miniature/card interface.
* Contacts — expanded
   * Contacts should also have an expanded view.
   * Clicking through to expanded Contacts should expose the fuller contact information and functionality.
   * Individual contacts should remain clickable and functional there.
   * The miniature and expanded interfaces should represent the same underlying contact data rather than becoming separate implementations.
* "Where the material comes from"
   * Remove Where the material comes from as a project-home module.
   * It is not useful enough to occupy dashboard/module space.
   * Move this functionality/information into the three-dot menu / Settings area instead.
* Project Settings migration
   * The old-fashioned / legacy Project Settings interface has been reintroduced.
   * Remove/fix this.
   * The whole point is to migrate functionality to the new interface.
   * Project settings should use the new interface/design system.
   * Do not retain or resurrect the legacy settings UI.
   * Remove duplicated settings functionality created by having old and new interfaces coexist.
   * There should ultimately be one coherent settings experience.
* Documents & Files thumbnails
   * Not every document currently receives a proper thumbnail.
   * Fix thumbnail generation/rendering so documents consistently have appropriate thumbnails.
   * Handle different supported document/file types sensibly rather than leaving broken or missing thumbnail states.
* Documents & Files — thumbnail view
   * Documents displayed as thumbnails should remain clickable.
   * Clicking a document should open it appropriately.
* Documents & Files — list view
   * Documents in list view must also be clickable.
   * Currently they do not open, while thumbnail-view documents do.
   * Fix this inconsistency.
   * Opening a document should work regardless of whether the user is using list or thumbnail view.
* Adding files — local upload
   * Continue supporting upload of files from the user's local computer.
* Adding files — third-party sources
   * Do not restrict Add File to local uploads.
   * Provide alternative sources for adding/importing files.
   * In particular, support adding files through Google Drive.
   * Architect the Add File experience so other appropriate external sources can also be supported rather than hard-coding it exclusively around local uploads.
* Home navigation
   * Remove the word Home from the top-left navigation.
   * Replace it with a recognisable Home icon.
   * The icon performs the same navigation function without unnecessarily occupying space with the word.
* Per-project heading colour
   * Each project should allow the user to customise its heading colour.
   * This provides visual differentiation between projects.
* Per-project SVG icon
   * Allow each project to have an assigned SVG icon file.
   * The SVG should visually identify/differentiate that project.
* Per-project custom image icon
   * In addition to SVG icons, allow the user to upload/select a custom image icon for a project.
   * The project therefore should not be restricted to a predefined icon library.
* Project appearance/background customisation
   * Allow the general background of an individual project view to be customised.
   * Support different colours.
   * Support different textures.
   * Support custom background images.
   * These appearance options should integrate cleanly with the rest of the project's visual theme rather than simply placing an image behind unreadable content.
* Third-party service branding
   * Whenever the interface references a recognised third-party service, use the service's recognisable logo/icon rather than presenting everything as generic text/icons.
   * This particularly applies to integrations/settings.
* NotebookLM
   * References/integrations involving [NotebookLM](https://notebooklm.google.com/?utm_source=chatgpt.com) should use the appropriate NotebookLM/Google branding or logo.
* Notion
   * References/integrations involving [Notion](https://www.notion.com/?utm_source=chatgpt.com) should display the Notion logo.
* Google Drive
   * References/integrations involving [Google Drive](https://drive.google.com/?utm_source=chatgpt.com) should display the Google Drive logo.
   * This applies particularly to the alternative file-import workflow.
* General integration-logo rule
   * Apply this principle consistently to other recognised third-party services as they are introduced.
   * Users should be able to visually identify the integration from its logo without having to read every label.
* Remove duplication throughout
   * Explicitly inspect the interface for functionality that has accidentally been implemented twice.
   * Do not retain old controls merely because new controls have been added.
   * Examples already identified include Ask the Team, the separate Chat to the Team module, and the legacy Project Settings interface.
   * When functionality is migrated to the new interface, remove the superseded implementation.
* Overall interaction principle
   * Anything that looks clickable should actually be clickable.
   * Miniatures should provide useful direct interaction.
   * Expanded views provide richer functionality when necessary.
   * Expanded views should generally use modal/pop-up behaviour.
   * Dashboard modules should be draggable and resizable.
   * The dashboard should intelligently prevent collisions/overlaps.
   * The result should feel like one coherent application rather than a collection of partially connected mock-ups.
* Overall visual principle
   * Increase the visual quality and richness of the project interface.
   * Stronger borders, tasteful gradients, hover glow, resizing feedback and richer surfaces should create substantially more depth.
   * Preserve usability while making the application feel more polished, premium and visually distinctive.
   * Do not solve individual visual requests in isolation; they should form a consistent design system across the new interface.
