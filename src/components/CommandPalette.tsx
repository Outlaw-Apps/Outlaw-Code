import { Fragment } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import type { AppCommand, AppCommandId } from '../lib/app-commands';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly AppCommand[];
  onExecute: (command: AppCommandId) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onExecute,
}: CommandPaletteProps) {
  const categories = [...new Set(commands.map((command) => command.category))];

  const execute = (command: AppCommandId) => {
    onOpenChange(false);
    onExecute(command);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command..." autoFocus />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {categories.map((category, index) => (
          <Fragment key={category}>
            {index > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={category}>
              {commands
                .filter((command) => command.category === category)
                .map((command) => (
                  <CommandItem
                    key={command.id}
                    value={`${command.title} ${command.id}`}
                    onSelect={() => execute(command.id)}
                    className="text-xs cursor-pointer"
                  >
                    <span>{command.title}</span>
                    {'shortcut' in command && command.shortcut ? (
                      <CommandShortcut>{command.shortcut}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
