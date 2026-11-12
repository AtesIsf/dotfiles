local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
    vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "https://github.com/folke/lazy.nvim.git",
        "--branch=stable", -- latest stable release
        lazypath,
    })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
    "neovim/nvim-lspconfig",
    "williamboman/mason.nvim",
    "hrsh7th/nvim-cmp",
    "hrsh7th/cmp-nvim-lsp",
    "hrsh7th/cmp-buffer",
    "hrsh7th/cmp-path",
    "L3MON4D3/LuaSnip",
    "saadparwaiz1/cmp_luasnip",
    { "nvim-treesitter/nvim-treesitter", lazy = false, build = ":TSUpdate" },
    {
        "nvim-telescope/telescope.nvim",
        dependencies = { "nvim-lua/plenary.nvim" }
    },
    {
        "windwp/nvim-autopairs",
        event = "InsertEnter",
        config = true
        -- use opts = {} for passing setup options
        -- this is equivalent to setup({}) function
    },
    "nvim-tree/nvim-web-devicons",
    "nvim-lualine/lualine.nvim",
    { "shaunsingh/nord.nvim", lazy = false, priority = 1000 },
})

local builtin = require('telescope.builtin')
vim.keymap.set('n', '<leader>ff', builtin.find_files, {})
vim.keymap.set('n', '<leader>fg', builtin.live_grep, {})
vim.keymap.set('n', '<leader>fb', builtin.buffers, {})
vim.keymap.set('n', '<leader>fh', builtin.help_tags, {})

if vim.fn.has('termguicolors') == 1 then
    vim.opt.termguicolors = true
end

vim.opt.background = "dark"

-- Install treesitter parsers (runs async; no-op if already installed)
require('nvim-treesitter').install { 'c', 'python', 'bash', 'rust' }

-- Enable treesitter highlighting for filetypes with installed parsers
vim.api.nvim_create_autocmd('FileType', {
    callback = function()
        -- pcall so it silently skips filetypes without a parser
        pcall(vim.treesitter.start)
    end,
})

vim.cmd("colorscheme nord")

require('lualine').setup({
    options = { theme = 'nord' }
})

-- Your general Neovim settings
vim.cmd [[
    set number
    set relativenumber
    set tabstop=4
    set shiftwidth=4
    set expandtab
    set softtabstop=-1
    set smartindent
    set encoding=utf-8
    set signcolumn=yes
    set mouse=
    set so=7
    set colorcolumn=80
]]

-- LSP keymaps (set when a server attaches to a buffer)
-- Note: Neovim 0.12 provides these defaults: gd, gD, grn, grr, gri, gra, gO, Ctrl-S
-- We only add custom keymaps here.
vim.api.nvim_create_autocmd('LspAttach', {
    callback = function(ev)
        local opts = { buffer = ev.buf, silent = true }

        vim.keymap.set('n', '<leader>K', function()
            vim.lsp.buf.hover({
                border = "rounded",
            })
        end, opts)

        vim.keymap.set('n', '<leader>d', function()
            vim.diagnostic.open_float({
                scope = "cursor",
                border = "rounded",
                focusable = false,
            })
        end, vim.tbl_extend('force', opts, { desc = "Show diagnostic message" }))

        vim.keymap.set('n', '<leader>rn', vim.lsp.buf.rename, opts)
        vim.keymap.set('n', '<leader>ca', vim.lsp.buf.code_action, opts)
    end,
})

require("mason").setup()

-- Enable LSP servers (configs provided by nvim-lspconfig)
vim.lsp.enable('clangd')
vim.lsp.enable('rust_analyzer')
vim.lsp.enable('basedpyright')
vim.lsp.enable('gopls')
vim.lsp.enable('htmx')
vim.lsp.enable('html')

-- Autocompletion setup
local cmp = require('cmp')
local luasnip = require('luasnip')

cmp.setup({
    snippet = {
        expand = function(args)
            luasnip.lsp_expand(args.body)
        end,
    },
    mapping = cmp.mapping.preset.insert({
        ['<C-d>'] = cmp.mapping.scroll_docs(-4),
        ['<C-f>'] = cmp.mapping.scroll_docs(4),
        ['<C-Space>'] = cmp.mapping.complete(),
        ['<CR>'] = cmp.mapping.confirm({
            behavior = cmp.ConfirmBehavior.Replace,
            select = true,
        }),
        ['<Tab>'] = cmp.mapping(function(fallback)
            if cmp.visible() then
                cmp.select_next_item()
            else
                fallback()
            end
        end, { 'i', 's' }),
        ['<S-Tab>'] = cmp.mapping(function(fallback)
            if cmp.visible() then
                cmp.select_prev_item()
            else
                fallback()
            end
        end, { 'i', 's' }),
    }),
    sources = {
        { name = 'nvim_lsp' },
        { name = 'luasnip' },
        { name = 'buffer' },
        { name = 'path' },
    },
})

