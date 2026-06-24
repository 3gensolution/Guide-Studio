# NixOS module for GuideStudio
# Usage in flake-based NixOS config:
#
#   inputs.guidestudio.url = "github:guidestudio/guide-studio";
#
#   { inputs, ... }: {
#     imports = [ inputs.guidestudio.nixosModules.default ];
#     programs.guidestudio.enable = true;
#   }
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.guidestudio;
in
{
  options.programs.guidestudio = {
    enable = lib.mkEnableOption "GuideStudio screen recorder";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.guidestudio;
      defaultText = lib.literalExpression "inputs.guidestudio.packages.\${pkgs.stdenv.hostPlatform.system}.guidestudio";
      description = "The GuideStudio package to use.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    # Screen capture on Wayland requires xdg-desktop-portal.
    # We enable the base portal; users should also enable a
    # desktop-specific portal (e.g. xdg-desktop-portal-gtk,
    # xdg-desktop-portal-hyprland) in their DE config.
    xdg.portal.enable = lib.mkDefault true;
  };
}
